# Duel Manager — Vercel Ready

Game browser 1v1 draft sepak bola:

- Roster sudah tersedia dari `public/data/players.snapshot.json`.
- Tidak perlu import team ID saat main.
- Bisa buat room online dengan kode.
- Cocok deploy ke Vercel sebagai static site.
- Online realtime memakai Firebase Realtime Database.
- Data pemain bisa di-update sekali lewat API-Football, lalu dibekukan menjadi snapshot JSON.

## 1. Jalankan lokal

```bash
npm install
npm run dev
```

Buka:

```text
http://localhost:3000
```

Tanpa Firebase, tekan **Main Offline 1 Device**.

## 2. Aktifkan online room code

Buat Firebase project:

1. Firebase Console → Create Project.
2. Build → Realtime Database → Create Database.
3. Pilih region dekat, misalnya Asia Southeast kalau tersedia.
4. Project settings → Add app → Web app.
5. Copy config web app.
6. Buka `public/firebase-config.js`.
7. Ubah `firebaseEnabled = true`.
8. Paste config Firebase kamu.

Contoh:

```js
export const firebaseEnabled = true;

export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  databaseURL: "https://...firebaseio.com",
  projectId: "...",
  storageBucket: "...appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

### Rules untuk test

File contoh ada di:

```text
firebase/database.rules.json
```

Untuk prototype, rules ini sengaja longgar supaya gampang jalan. Untuk public production, rules harus diperketat dengan Auth/App Check.

## 3. Update data pemain tanpa import manual saat main

Kamu tidak perlu hafal team ID. Script seed akan mencari team ID otomatis dari nama klub, lalu mengambil squad.

```bash
cp .env.example .env
```

Isi `.env`:

```env
API_FOOTBALL_KEY=api_key_kamu
API_FOOTBALL_HOST=v3.football.api-sports.io
API_FOOTBALL_SEASON=2025
```

Jalankan:

```bash
npm run seed:api-football
npm run validate:data
```

Output-nya akan menimpa:

```text
public/data/players.snapshot.json
```

Setelah itu deploy. Pemain sudah langsung muncul saat game dibuka. Tidak ada input ID lagi di UI.

## 4. Atur daftar klub yang ingin di-seed

Edit:

```text
data/api-football-targets.json
```

Tambahkan klub. Script akan resolve ID sendiri.

Contoh:

```json
{ "name": "Real Madrid", "league": 140, "country": "Spain" }
```

## 5. Deploy ke Vercel

Cara paling gampang:

1. Upload folder ini ke GitHub.
2. Buka Vercel.
3. Import repository.
4. Framework preset: Other / Static.
5. Output directory: `public`.
6. Deploy.

Kalau pakai Vercel CLI:

```bash
npm i -g vercel
vercel
vercel --prod
```

## 6. Batasan yang perlu kamu tahu

- Rating bukan rating resmi EA FC / Football Manager.
- Roster starter bukan jaminan terbaru. Untuk data terbaru, jalankan seed API-Football.
- Vercel hanya hosting frontend static di desain ini.
- Realtime room disimpan di Firebase Realtime Database.
- API-Football key hanya dipakai saat seed lokal, bukan saat pemain membuka game.

## 7. Kenapa arsitekturnya begini?

Vercel cocok untuk hosting frontend. Untuk room realtime, jangan paksa Vercel Serverless Function menyimpan state game. Pakai Firebase/Supabase/Ably/Upstash/Redis/Cloudflare Durable Object. Versi ini memakai Firebase karena paling cepat untuk prototype multiplayer kode room.
