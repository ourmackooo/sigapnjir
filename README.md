# SIGAP

SIGAP adalah platform pelaporan layanan publik yang diperluas menjadi **Sistem Informasi Manajemen Penanggulangan Bencana**. Modul laporan lama tetap dipakai untuk laporan lapangan; di atasnya ditambahkan lapisan **event → zona → dampak → aksi**:

- event banjir/longsor dengan status siaga, tanggap darurat, pemulihan, dan selesai;
- sensor ketinggian air yang memicu alert otomatis saat melewati ambang;
- verifikasi laporan warga sebelum masuk agregat dampak;
- peta operasi bersama, task organisasi, shelter, dan distribusi logistik;
- DSS prioritas zona yang bisa dijelaskan dan di-override dengan alasan;
- halaman peringatan publik tanpa data pribadi.

## Tech Stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19, recharts, MapLibre GL + react-map-gl + pmtiles/@protomaps/basemaps |
| Backend | Bun, Elysia, sesi `scrypt`, `postgres.js` |
| Database | PostgreSQL 16 |
| File/media | MinIO / SeaweedFS |
| Infra | Docker Compose, Nginx (reverse proxy + tile peta), Redis |
| AI Decision | Jev (routing laporan layanan publik) |

## Cara Menjalankan

### Opsi A (Docker)

```sh
docker compose up -d --build && DATABASE_URL="postgres://laporkuy:laporkuy@localhost:5432/laporkuy" bun run db:migrate
```

Buka <http://localhost:8080>.

### Opsi B (pengembangan lokal)

```sh
docker compose up -d db minio
bun install
DATABASE_URL="postgres://laporkuy:laporkuy@localhost:5432/laporkuy" bun run db:migrate
bun run dev        # http://localhost:3001
```

### Mode demo (tanpa database)

```sh
bun run demo
```

Data contoh ada di memori dan direset saat server berhenti.

### Tiga peran

- **Warga**: mengirim laporan dan memantau riwayatnya.
- **PIC**: satu petugas penghubung per instansi; melihat dan menindaklanjuti task instansinya saja.
- **BPBD**: pusat koordinasi; membuat event, menunjuk PIC, memberi task lintas instansi, verifikasi, broadcast, dan override prioritas.

### Akun contoh (mode demo)

| Peran | Email | Kata sandi |
|---|---|---|
| Warga | warga@demo.test | WargaDemo123! |
| BPBD | admin@demo.test | AdminDemo123! |
| PIC Dinas PU | petugas@demo.test | PetugasDemo123! |
| PIC BPBD | bpbd@demo.test | BpbdDemo123! |
| PIC Polres | polres@demo.test | PicDemo123! |
| PIC RSUD | rsud@demo.test | PicDemo123! |
| PIC PMI | pmi@demo.test | PicDemo123! |

### Akun seed database (setelah `db:migrate`)

| Peran | Email | Kata sandi |
|---|---|---|
| Warga | siti.rahayu@example.com | Rahayu123! |
| BPBD | admin@example.com | Admin@123 |
| PIC Dinas PUPR | instansi@laporkuy.dev | Instansi@123 |
| PIC BPBD | bpbd@example.com | Instansi@123 |
| PIC Polres | polres@example.com | Instansi@123 |
| PIC RSUD | rsud@example.com | Instansi@123 |
| PIC PMI | pmi@example.com | Instansi@123 |

## Alur Demo 5–7 Menit

1. Buka **/pemerintah/insiden** sebagai admin, buka event banjir.
2. Kirim pembacaan sensor yang melewati ambang bahaya:
   ```sh
   curl -X POST http://localhost:3000/api/sensors/SEN-01/readings \
     -H "x-sensor-token: demo-sensor-1" -H "content-type: application/json" \
     -d '{"water_cm":190}'
   ```
   Alert masuk ke lonceng dan zona berubah menjadi kritis.
3. Buka **/lapor**, kirim laporan warga dengan data dampak.
4. Verifikasi laporan di ruang komando → agregat zona dan skor DSS berubah.
5. Lakukan override prioritas dengan alasan.
6. Buat task evakuasi untuk Polres/RSUD/PMI; organisasi lain tidak melihat task tersebut.
7. Shelter mengajukan bantuan di **/pemerintah/logistik**, lalu alokasikan dan konfirmasi penerimaan.
8. Buka **/peringatan/:eventId** untuk halaman publik tanpa data pribadi.

## Fitur

- Landing page, login/registrasi, form laporan dengan peta, riwayat laporan warga.
- Peran **warga**, **instansi (dinas)**, dan **admin** pemerintah.
- Dashboard instansi & admin, tindak lanjut laporan, persetujuan selesai dua arah, diskusi penanganan.
- Insiden: daftar/buat event, peta operasi, agregat zona, antrean verifikasi.
- Sensor: ingest token, validasi numerik, rate limit sederhana, evaluasi ambang.
- DSS: skor prioritas 0–1 dengan kontribusi tiap faktor dan override beralasan.
- Koordinasi: peserta event, task per organisasi, shelter, notifikasi, broadcast stub.
- Logistik: permintaan, alokasi, penerimaan, ringkasan distribusi.
- Realtime: SSE in-process (satu instance; lihat komentar `ponytail`).
- Migrasi database, mode demo, dan akun contoh.

## Catatan Arsitektur

- Nama database, user, bucket, dan key `localStorage` sengaja tetap `laporkuy` agar sesi dan infrastruktur lama tidak putus.
- SSE hanya cocok untuk satu instance; ganti ke Redis pub/sub bila scale-out.
- Broadcast SMS/WhatsApp masih stub lewat `BROADCAST_PROVIDER=log`; jangan dianggap integrasi produksi.
- Non-goals MVP: aplikasi native, PWA offline penuh, poligon GIS, prediksi AI, auto-dispatch, chat real-time, ERP gudang, ML DSS, multi-tenant, CCTV/drone.
