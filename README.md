# SIGAP

SIGAP adalah platform pelaporan layanan publik berupa **Sistem Informasi Manajemen Penanggulangan Bencana** dengan laporan lapangan dan lapisan pemantauan berbasis dampak dan zona.

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

### Tiga peran

- **Warga**: mengirim laporan dan memantau riwayatnya.
- **PIC**: satu petugas penghubung per instansi; melihat dan menindaklanjuti task instansinya saja.
- **BPBD**: pusat koordinasi; membuat event, menunjuk PIC, memberi task lintas instansi, verifikasi, broadcast, dan override prioritas.

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
