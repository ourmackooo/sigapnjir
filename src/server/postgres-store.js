import postgres from "postgres";

function decoratePendingRouting(row) {
  if (!row) return row;
  const pending = row.routing_request_id
    ? { id: row.routing_request_id, requested_dinas_id: row.routing_requested_dinas_id,
        requested_dinas_name: row.requested_dinas_name, requested_by: row.routing_requested_by,
        previous_status: row.routing_previous_status, note: row.routing_note,
        created_at: row.routing_requested_at }
    : null;
  const { routing_request_id, routing_requested_dinas_id, routing_requested_by,
    routing_previous_status, routing_note, routing_requested_at, requested_dinas_name, ...rest } = row;
  return { ...rest, pending_routing: pending };
}

export function createPostgresStore() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required (set it in environment, not in code).");
  const sql = postgres(databaseUrl);
  return {
    async userByEmail(email) { return (await sql`select * from users where email = ${email}`)[0]; },
    async register(email, password_hash, full_name) {
      return (await sql`insert into users (email, password_hash, full_name) values (${email}, ${password_hash}, ${full_name}) returning *`)[0];
    },
    async session(token) {
      return (await sql`select u.* from sessions s join users u on u.id = s.user_id
        where s.token = ${token} and s.expires_at > now() and u.is_active = true`)[0];
    },
    async login(token, user_id) { await sql`insert into sessions (token,user_id,expires_at) values (${token},${user_id},now() + interval '7 days')`; },
    async logout(token) { await sql`delete from sessions where token = ${token}`; },
    async createReport(input) {
      return sql.begin(async tx => {
        const [row] = await tx`insert into reports (ticket_number,user_id,description_raw,image_url,is_public,lat,lng,address,
            event_id,zone_id,impact,source,verification_status)
          values (${input.ticket_number},${input.user_id},${input.description_raw},${input.image_url},${input.is_public},${input.lat},${input.lng},${input.address},
            ${input.event_id ?? null},${input.zone_id ?? null},${sql.json(input.impact ?? {})},${input.source ?? "warga"},'unverified') returning *`;
        await tx`insert into report_status_history (report_id,to_status,actor_id,actor_type,note,progress_percent)
          values (${row.id},'submitted',${input.user_id},'user','Laporan diterima oleh sistem.',0)`;
        return row;
      });
    },
    async list() {
      const rows = await sql`select r.*, d.name as dinas_name,
          rr.id as routing_request_id, rr.requested_dinas_id as routing_requested_dinas_id,
          rr.requested_by as routing_requested_by, rr.previous_status as routing_previous_status,
          rr.note as routing_note, rr.created_at as routing_requested_at,
          rd.name as requested_dinas_name
        from reports r
        left join dinas d on d.id=r.dinas_id
        left join lateral (select id, requested_dinas_id, requested_by, previous_status, note, created_at
          from routing_requests where report_id=r.id and status='pending'
          order by created_at desc limit 1) rr on true
        left join dinas rd on rd.id=rr.requested_dinas_id
        order by r.submitted_at desc`;
      return rows.map(decoratePendingRouting);
    },
    async get(id) { return decoratePendingRouting((await sql`select r.*,d.name as dinas_name from reports r left join dinas d on d.id=r.dinas_id where r.id=${id}`)[0]); },
    async ticket(ticket) { return decoratePendingRouting((await sql`select r.*,d.name as dinas_name from reports r left join dinas d on d.id=r.dinas_id where r.ticket_number=${ticket}`)[0]); },
    async history(id) { return sql`select id,from_status,to_status,note,progress_percent,created_at from report_status_history where report_id=${id} order by created_at`; },
    async feedbacks(reportId, userId) {
      return sql`select id,message,sender_name,sender_role,created_at,(sender_id = ${userId}) as mine
        from report_feedbacks where report_id=${reportId} order by created_at`;
    },
    async addFeedback(reportId, user, message) {
      return (await sql`insert into report_feedbacks (report_id,sender_id,sender_name,sender_role,message)
        values (${reportId},${user.id},${user.full_name ?? null},${user.role},${message})
        returning id,message,sender_name,sender_role,created_at,true as mine`)[0];
    },
    async dinas() {
      return sql`select d.id,d.slug,d.name,d.kind,d.pic_user_id,u.full_name as pic_name,u.email as pic_email
        from dinas d left join users u on u.id=d.pic_user_id where d.is_active=true order by d.name`;
    },
    async setPic(dinasId, userId) {
      return (await sql`update dinas set pic_user_id=${userId} where id=${dinasId} returning id,slug,name,pic_user_id`)[0];
    },
    async askFaqQuestion(userId, question) {
      return (await sql`insert into faq_questions (user_id,question) values (${userId},${question}) returning *`)[0];
    },
    async faqQuestionsByUser(userId) {
      return sql`select * from faq_questions where user_id=${userId} order by created_at desc`;
    },
    async faqQuestions(status) {
      return sql`select fq.*, u.full_name as user_name from faq_questions fq
        join users u on u.id=fq.user_id
        ${status ? sql`where fq.status=${status}` : sql``}
        order by fq.created_at desc`;
    },
    async answerFaqQuestion(id, adminId, answer) {
      const [row] = await sql`update faq_questions set answer=${answer},answered_by=${adminId},answered_at=now(),status='answered'
        where id=${id} returning *`;
      return row ?? null;
    },
    async kategori() { return sql`select id,slug,name from kategori where is_active=true`; },
    async kategoriDinasMapping() {
      const rows = await sql`select k.slug as kategori, d.slug as dinas
        from kategori_dinas kd join kategori k on k.id=kd.kategori_id
        join dinas d on d.id=kd.dinas_id where k.is_active and d.is_active`;
      const mapping = {};
      for (const r of rows) (mapping[r.kategori] ??= []).push(r.dinas);
      for (const key of Object.keys(mapping)) mapping[key] = [...new Set(mapping[key])];
      return mapping;
    },
    async activeModelConfig() {
      return (await sql`select * from ai.model_configs where is_active=true order by created_at desc limit 1`)[0];
    },
    // Fallback saat AI gagal 2x: tandai perlu ditinjau tanpa hasil klasifikasi.
    async markNeedsReview(id, note) {
      return sql.begin(async tx => {
        const [before] = await tx`select * from reports where id=${id} for update`;
        if (!before || before.status !== "submitted") return null;
        await tx`update reports set status='needs_review',updated_at=now() where id=${id}`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_type,note,progress_percent)
          values (${id},'submitted','needs_review','system',${note},0)`;
        return true;
      });
    },
    // Penetapan dinas oleh admin lintas status; needs_review yang diberi dinas -> routed.
    async assignDinas(id, dinasId, adminId) {
      return sql.begin(async tx => {
        const [before] = await tx`select * from reports where id=${id} for update`;
        if (!before) return null;
        const newStatus = before.status === "needs_review" && dinasId ? "routed" : before.status;
        const [after] = await tx`update reports set dinas_id=${dinasId},status=${newStatus},updated_at=now() where id=${id} returning *`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
          values (${id},${before.status},${newStatus},${adminId},'admin',
          ${dinasId ? `Admin menetapkan dinas tujuan${before.status === "needs_review" ? "; laporan dirutekan" : ""}.` : "Dinas tujuan dikosongkan oleh admin."},0)`;
        // Jika ada permintaan perutean yang menunggu, penetapan dinas admin dianggap menyetujuinya.
        await tx`update routing_requests set status='approved',decided_by=${adminId},decided_at=now()
          where report_id=${id} and status='pending'`;
        return after;
      });
    },
    // Permintaan perutean ulang oleh pelapor (Rutekan Balik). Status laporan -> needs_review
    // agar masuk antrean admin; riwayat + diskusi tetap tercatat.
    async pendingRoutingRequest(reportId) {
      return decoratePendingRouting((await sql`select r.*, d2.name as requested_dinas_name,
          rr.id as routing_request_id, rr.requested_dinas_id as routing_requested_dinas_id,
          rr.requested_by as routing_requested_by, rr.previous_status as routing_previous_status,
          rr.note as routing_note, rr.created_at as routing_requested_at
        from routing_requests rr
        join reports r on r.id = rr.report_id
        join dinas d2 on d2.id = rr.requested_dinas_id
        where rr.report_id=${reportId} and rr.status='pending'
        order by rr.created_at desc limit 1`)[0])?.pending_routing ?? null;
    },
    async requestReroute(reportId, user, dinasId, note) {
      return sql.begin(async tx => {
        const [row] = await tx`select * from reports where id=${reportId} for update`;
        if (!row) return null;
        const dup = await tx`select 1 from routing_requests where report_id=${reportId} and status='pending' limit 1`;
        if (dup.length) return { error: "already_pending" };
        const dinas = (await tx`select name from dinas where id=${dinasId}`)[0];
        if (!dinas) return { error: "invalid_dinas" };
        const message = note ? `Permintaan perutean ke ${dinas.name}. ${note}` : `Meminta perutean ke ${dinas.name}.`;
        await tx`insert into routing_requests (report_id,requested_dinas_id,requested_by,previous_status,note)
          values (${reportId},${dinasId},${user.id},${row.status},${message})`;
        await tx`update reports set status='needs_review',updated_at=now() where id=${reportId}`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
          values (${reportId},${row.status},'needs_review',${user.id},'user',${message},${row.progress_percent})`;
        await tx`insert into report_feedbacks (report_id,sender_id,sender_name,sender_role,message)
          values (${reportId},${user.id},${user.full_name ?? null},'user',${message})`;
        return { ok: true };
      });
    },
    async decideReroute(reportId, requestId, admin, decision, note) {
      return sql.begin(async tx => {
        const [req] = await tx`select * from routing_requests where id=${requestId} and report_id=${reportId} for update`;
        if (!req || req.status !== "pending") return { error: "no_pending" };
        const [row] = await tx`select * from reports where id=${reportId} for update`;
        if (!row) return { error: "not_found" };
        const dinas = (await tx`select name from dinas where id=${req.requested_dinas_id}`)[0];
        const dinasName = dinas?.name ?? "dinas tujuan";
        if (decision === "approve") {
          await tx`update routing_requests set status='approved',decided_by=${admin.id},decided_at=now() where id=${requestId}`;
          const [after] = await tx`update reports set status='routed',dinas_id=${req.requested_dinas_id},updated_at=now(),routed_at=now()
            where id=${reportId} returning *`;
          const message = note ? `Perutean ke ${dinasName} disetujui admin. ${note}` : `Perutean ke ${dinasName} disetujui admin.`;
          await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
            values (${reportId},${row.status},'routed',${admin.id},'admin',${message},${row.progress_percent})`;
          await tx`insert into report_feedbacks (report_id,sender_id,sender_name,sender_role,message)
            values (${reportId},${admin.id},${admin.full_name ?? null},'admin',${message})`;
          return { report: after, previousStatus: req.previous_status };
        }
        await tx`update routing_requests set status='rejected',decided_by=${admin.id},decided_at=now() where id=${requestId}`;
        const [after] = await tx`update reports set status=${req.previous_status},updated_at=now()
          where id=${reportId} returning *`;
        const message = note ? `Permintaan perutean ke ${dinasName} ditolak admin. ${note}` : `Permintaan perutean ke ${dinasName} ditolak admin.`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
          values (${reportId},${row.status},${req.previous_status},${admin.id},'admin',${message},${row.progress_percent})`;
        await tx`insert into report_feedbacks (report_id,sender_id,sender_name,sender_role,message)
          values (${reportId},${admin.id},${admin.full_name ?? null},'admin',${message})`;
        return { report: after, previousStatus: req.previous_status };
      });
    },
    // Hasil AI: update lintasan + simpan classification. Hanya jalan dari status `submitted`.
    async routeReport(id, input) {
      return sql.begin(async tx => {
        const [before] = await tx`select * from reports where id=${id} for update`;
        if (!before || before.status !== "submitted") return null;
        const routed = input.status === "routed";
        const [after] = await tx`update reports set status=${input.status},dinas_id=${input.dinas_id},
          category_id=${input.category_id},urgency=${input.urgency},description_redacted=${input.description_redacted},
          updated_at=now(),routed_at=${routed ? new Date() : null} where id=${id} returning *`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_type,note,progress_percent)
          values (${id},${before.status},${input.status},'system',
          ${routed ? "Laporan dirutekan otomatis ke dinas terkait." : "Laporan di bawah ambang keyakinan; menunggu tinjauan admin."},0)`;
        await tx`insert into ai.classifications (report_id,model_config_id,input_redacted,input_sent,output_json,
          dinas_id,category_id,urgency,confidence,category_confidence,dinas_confidence,urgency_confidence,
          pii_types,latency_ms,token_usage)
          values (${id},${input.model_config_id},${input.input_redacted},${input.input_sent},${input.output_json},
          ${input.dinas_id},${input.category_id},${input.urgency},${input.confidence},
          ${input.category_confidence},${input.dinas_confidence},${input.urgency_confidence},
          ${input.pii_types ?? null},${input.latency_ms},${input.token_usage ?? null})`;
        await tx`insert into audit_logs (actor_type,action,entity_type,entity_id)
          values ('system',${routed ? "jev_route" : "jev_needs_review"},'report',${id})`;
        return after;
      });
    },
    async update(id, input, actor, expected) {
      return sql.begin(async tx => {
        const [before] = await tx`select * from reports where id=${id} for update`;
        if (!before || new Date(before.updated_at).toISOString() !== new Date(expected).toISOString()) return null;
        const resolved = input.status === "resolved";
        const [after] = await tx`update reports set status=${input.status},progress_percent=${input.progress_percent},
          dinas_id=${input.dinas_id},moderation_status=${input.moderation_status},
          public_title=${input.public_title},public_location=${input.public_location},
          description_redacted=${input.description_redacted},updated_at=now(),
          resolved_at=${resolved ? new Date() : null},
          resolution_requested_at=${resolved ? new Date() : null},
          resolution_request_note=${resolved ? input.note : null}
          where id=${id} returning *`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
          values (${id},${before.status},${input.status},${actor.id},${actor.role},${input.note},${input.progress_percent})`;
        if (before.user_id) await tx`insert into notifications (user_id,report_id,type,payload)
          values (${before.user_id},${id},'report_update',${JSON.stringify({ status: input.status, progress_percent: input.progress_percent })})`;
        await tx`insert into audit_logs (actor_id,actor_type,action,entity_type,entity_id)
          values (${actor.id},${actor.role},'report_update','report',${id})`;
        return after;
      });
    },
    async respondResolution(id, action, userId) {
      return sql.begin(async tx => {
        const [row] = await tx`select * from reports where id=${id} for update`;
        if (!row || row.user_id !== userId) return null;
        if (!row.resolution_requested_at) return { error: "no_request" };
        if (action === "approve") {
          const [after] = await tx`update reports set resolution_requested_at=null,resolution_request_note=null,updated_at=now()
            where id=${id} returning *`;
          await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
            values (${id},'resolved','resolved',${userId},'user','Pelapor menyetujui status selesai.',100)`;
          return { report: after };
        }
        if (action !== "reject") return { error: "invalid_action" };
        const [prev] = await tx`select progress_percent from report_status_history
          where report_id=${id} and progress_percent < 100 order by created_at desc limit 1`;
        const progress = prev ? prev.progress_percent : 0;
        const [after] = await tx`update reports set status='in_progress',progress_percent=${progress},resolved_at=null,
          resolution_requested_at=null,resolution_request_note=null,updated_at=now()
          where id=${id} returning *`;
        await tx`insert into report_status_history (report_id,from_status,to_status,actor_id,actor_type,note,progress_percent)
          values (${id},'resolved','in_progress',${userId},'user','Pelapor menolak status selesai; laporan dikembalikan untuk ditangani kembali.',${progress})`;
        if (row.dinas_id) await tx`insert into notifications (user_id,report_id,type,payload)
          select id,${id},'resolution_rejected',${JSON.stringify({ progress_percent: progress })}
          from users where role='pemerintah' and dinas_id=${row.dinas_id}`;
        return { report: after };
      });
    },

    // --- SIGAP incidents ---
    async listEvents() {
      return sql`select e.*, u.full_name as commander_name from disaster_events e
        left join users u on u.id=e.commander_id order by e.started_at desc`;
    },
    async createEvent(input) {
      return (await sql`insert into disaster_events (code,name,type,status,started_at,commander_id)
        values (${input.code},${input.name},${input.type},${input.status ?? "siaga"},${input.started_at ?? new Date()},${input.commander_id ?? null})
        returning *`)[0];
    },
    async getEvent(id) { return (await sql`select * from disaster_events where id=${id}`)[0]; },
    async updateEvent(id, patch) {
      const fields = {};
      for (const key of ["name", "type", "status", "started_at", "ended_at", "commander_id"]) if (patch[key] !== undefined) fields[key] = patch[key];
      if (!Object.keys(fields).length) return (await sql`select * from disaster_events where id=${id}`)[0];
      return (await sql`update disaster_events set ${sql(fields)}, updated_at=now() where id=${id} returning *`)[0];
    },
    async activeEvent() {
      return (await sql`select * from disaster_events where status in ('siaga','tanggap_darurat') order by started_at desc limit 1`)[0];
    },
    async listZones() { return sql`select * from zones order by level, name`; },
    async eventZones(eventId) {
      return sql`select ez.event_id, ez.status, ez.source, ez.first_seen_at, ez.updated_at,
          z.id, z.code, z.name, z.level, z.parent_id, z.lat, z.lng, z.population, z.vulnerable_population
        from event_zones ez join zones z on z.id=ez.zone_id
        where ez.event_id=${eventId} order by z.name`;
    },
    async upsertEventZone(eventId, zoneId, patch) {
      return (await sql`insert into event_zones (event_id,zone_id,status,source)
        values (${eventId},${zoneId},${patch.status ?? "waspada"},${patch.source ?? "manual"})
        on conflict (event_id,zone_id) do update set status=excluded.status, source=excluded.source, updated_at=now()
        returning *`)[0];
    },
    async reportsForEvent(eventId) {
      return sql`select * from reports where event_id=${eventId} order by submitted_at desc`;
    },
    async pendingReports(eventId) {
      return eventId
        ? sql`select * from reports where event_id=${eventId} and verification_status='unverified' order by submitted_at`
        : sql`select * from reports where event_id is not null and verification_status='unverified' order by submitted_at`;
    },
    async verifyReport(id, input) {
      return (await sql`update reports set verification_status=${input.verification_status},
        impact=${sql.json(input.impact)}, zone_id=${input.zone_id ?? null},
        verified_by=${input.verified_by ?? null}, verified_at=now(), updated_at=now()
        where id=${id} returning *`)[0];
    },
    async listSensors() {
      return sql`select s.*, z.name as zone_name from sensors s left join zones z on z.id=s.zone_id order by s.code`;
    },
    async sensorByCode(code) { return (await sql`select * from sensors where code=${code}`)[0]; },
    async createSensor(input) {
      return (await sql`insert into sensors (code,name,zone_id,lat,lng,warn_cm,danger_cm,token_hash)
        values (${input.code},${input.name},${input.zone_id ?? null},${input.lat},${input.lng},${input.warn_cm},${input.danger_cm},${input.token_hash})
        returning *`)[0];
    },
    async touchSensor(id) { await sql`update sensors set last_seen_at=now() where id=${id}`; },
    async addReading(input) {
      return (await sql`insert into sensor_readings (sensor_id,water_cm,recorded_at,status)
        values (${input.sensor_id},${input.water_cm},${input.recorded_at},${input.status})
        on conflict (sensor_id,recorded_at) do nothing returning *`)[0];
    },
    async recentReadingsForSensor(sensorId, limit = 3) {
      return sql`select * from sensor_readings where sensor_id=${sensorId} order by recorded_at desc limit ${limit}`;
    },
    async eventParticipants(eventId) {
      return sql`select ep.id, ep.event_id, ep.dinas_id, ep.role, d.name as dinas_name, d.kind as dinas_kind,
          u.full_name as pic_name, u.email as pic_email
        from event_participants ep
        join dinas d on d.id=ep.dinas_id
        left join users u on u.id=d.pic_user_id
        where ep.event_id=${eventId} order by ep.role, d.name`;
    },
    async addParticipant(eventId, dinasId, role) {
      return (await sql`insert into event_participants (event_id,dinas_id,role) values (${eventId},${dinasId},${role})
        on conflict (event_id,dinas_id) do update set role=excluded.role returning *`)[0];
    },
    async getTask(id) {
      return (await sql`select t.*, d.name as dinas_name from incident_tasks t join dinas d on d.id=t.dinas_id where t.id=${id}`)[0];
    },
    async tasksForEvent(eventId, dinasId) {
      return dinasId
        ? sql`select t.*, d.name as dinas_name from incident_tasks t join dinas d on d.id=t.dinas_id
            where t.event_id=${eventId} and t.dinas_id=${dinasId} order by t.created_at desc`
        : sql`select t.*, d.name as dinas_name from incident_tasks t join dinas d on d.id=t.dinas_id
            where t.event_id=${eventId} order by t.created_at desc`;
    },
    async createTask(input) {
      return (await sql`insert into incident_tasks (event_id,dinas_id,title,description,status,assigned_to,due_at,created_by)
        values (${input.event_id},${input.dinas_id},${input.title},${input.description ?? null},${input.status ?? "open"},${input.assigned_to ?? null},${input.due_at ?? null},${input.created_by ?? null})
        returning *`)[0];
    },
    async updateTask(id, patch) {
      const fields = {};
      for (const key of ["title", "description", "status", "assigned_to", "due_at", "dinas_id"]) if (patch[key] !== undefined) fields[key] = patch[key];
      if (!Object.keys(fields).length) return (await sql`select * from incident_tasks where id=${id}`)[0];
      return (await sql`update incident_tasks set ${sql(fields)}, updated_at=now() where id=${id} returning *`)[0];
    },
    async shelters(zoneId) {
      return zoneId
        ? sql`select * from shelters where zone_id=${zoneId} order by name`
        : sql`select * from shelters order by name`;
    },
    async createShelter(input) {
      return (await sql`insert into shelters (zone_id,name,lat,lng,capacity,occupancy,status,contact,needs)
        values (${input.zone_id},${input.name},${input.lat},${input.lng},${input.capacity ?? 0},${input.occupancy ?? 0},${input.status ?? "aktif"},${input.contact ?? null},${sql.json(input.needs ?? [])})
        returning *`)[0];
    },
    async updateShelter(id, patch) {
      const fields = {};
      for (const key of ["name", "capacity", "occupancy", "status", "contact"]) if (patch[key] !== undefined) fields[key] = patch[key];
      if (patch.needs !== undefined) fields.needs = sql.json(patch.needs);
      if (!Object.keys(fields).length) return (await sql`select * from shelters where id=${id}`)[0];
      return (await sql`update shelters set ${sql(fields)}, updated_at=now() where id=${id} returning *`)[0];
    },
    async priorityOverrides(eventId) { return sql`select * from priority_overrides where event_id=${eventId}`; },
    async upsertPriorityOverride(input) {
      return (await sql`insert into priority_overrides (event_id,zone_id,score,reason,actor_id)
        values (${input.event_id},${input.zone_id},${input.score},${input.reason},${input.actor_id ?? null})
        on conflict (event_id,zone_id) do update set score=excluded.score, reason=excluded.reason, actor_id=excluded.actor_id, created_at=now()
        returning *`)[0];
    },
    async logisticsForEvent(eventId) {
      return sql`select l.*, s.name as shelter_name from logistics_requests l join shelters s on s.id=l.shelter_id
        where l.event_id=${eventId} order by s.name, l.item`;
    },
    async createLogistics(input) {
      return (await sql`insert into logistics_requests (event_id,shelter_id,item,qty_requested,requested_by)
        values (${input.event_id},${input.shelter_id},${input.item},${input.qty_requested},${input.requested_by ?? null}) returning *`)[0];
    },
    async updateLogistics(id, patch) {
      const fields = {};
      for (const key of ["qty_allocated", "qty_received", "status"]) if (patch[key] !== undefined) fields[key] = patch[key];
      if (!Object.keys(fields).length) return (await sql`select * from logistics_requests where id=${id}`)[0];
      return (await sql`update logistics_requests set ${sql(fields)}, updated_at=now() where id=${id} returning *`)[0];
    },
    async getLogistics(id) { return (await sql`select * from logistics_requests where id=${id}`)[0]; },
    async notifications(userId) {
      return sql`select * from notifications where user_id=${userId} order by created_at desc limit 30`;
    },
    async markNotificationRead(id, userId) {
      return (await sql`update notifications set read_at=now() where id=${id} and user_id=${userId} returning *`)[0];
    },
    async addNotification(userId, type, payload) {
      return (await sql`insert into notifications (user_id,type,payload,report_id) values (${userId},${type},${sql.json(payload ?? {})},${null}) returning *`)[0];
    },
    async audit(input) {
      await sql`insert into audit_logs (actor_id,actor_type,action,entity_type,entity_id,metadata)
        values (${input.actor_id ?? null},${input.actor_type ?? null},${input.action},${input.entity_type},${input.entity_id},${sql.json(input.metadata ?? {})})`;
    },
    async usersByDinas(dinasId) {
      return sql`select id,email,full_name,role,dinas_id from users where dinas_id=${dinasId} and is_active=true`;
    },
  };
}
