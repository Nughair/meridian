# Paper LP Meridian

Simulator terisolasi untuk buku virtual. Proses ini tidak membuat koneksi Solana, tidak menandatangani transaksi, dan tidak mengirim pesan Telegram.

Modal awal **USD 1000**. Setiap posisi baru, kalau semua gerbang strategi lolos, memakai **USD 100**. Angka itu adalah batas operator untuk buku ini. Sizing live tetap `computeDeployAmount` dalam SOL; gerbang 0,5 SOL, cadangan gas 0,2 SOL, dan maksimum 3 posisi tetap dipakai.

## Yang bisa dan tidak bisa direproduksi

Rantai dan venue dibaca dari sumber, bukan diasumsikan: Solana, pool Meteora DLMM, token X adalah mint sinyal, token Y adalah SOL. Masuk hanya dari konvergensi wallet LP yang dilacak (default 2 wallet, jendela 120 detik, deposit quote minimal 0,1 SOL, bukan rebalance). Strategi posisi live adalah `bid_ask`, satu sisi SOL, `bins_above = 0`, `bins_below` dari volatilitas 30 menit dan dibatasi 35–69.

Buku ini **tidak 100% setara** dengan bot live selama hal berikut belum ada:

- Daftar wallet LP yang benar-benar dipantau. `paper/watchlist.json` sengaja kosong. Tanpa itu tidak ada sinyal, dan tidak ada posisi yang diada-adakan.
- Bukti baca RPC bahwa otoritas mint/freeze sudah mati dan eksposur wallet pemicu masih ada. Paper tidak membuka RPC.
- Posisi on-chain untuk fee dan impermanent loss. APR serta fee/TVL pool tidak dihitung sebagai fee yang diperoleh.
- Path `manageOnce` 10 menit yang bisa menutup pada satu pembacaan. Paper mengikuti poller cepat: sinyal keluar yang sama harus muncul 2 kali.
- Blacklist, blocklist deployer, dan cooldown `pool-memory.json` milik operator.

Tidak ada rebalance di bot standalone. Harga yang bergerak keluar rentang ditutup oleh aturan, bukan digeser.

## Menjalankan

Butuh Node.js 18 atau lebih baru. Tidak perlu `WALLET_PRIVATE_KEY`, token Telegram, atau kunci Jupiter. Kalau salah satu variabel itu ada di environment, proses menolak start.

```sh
npm run paper:scan
```

Perintah itu satu kali selesai. Bukan layanan 24/7. Supaya berjalan terus di komputer operator, jadwalkan sendiri (cron atau proses yang diawasi) dan simpan `paper/state/` di disk yang tidak hilang saat restart. Satu eksekusi cloud tidak menjaga bot tetap hidup.

Hasil:

| Berkas | Isi |
|---|---|
| `paper/state/ledger.json` | Kas, posisi, percobaan, dan riwayat. Tulisan atomik. Buku rusak tidak direset menjadi kosong. |
| `paper/state/status.json` | Ringkasan scan terakhir, harga SOL bila sumber publik menjawab, dan celah reproduksi. |
| `paper/state/outbox.jsonl` | Satu JSON per baris untuk bot yang sudah ada. |

Scan ulang tidak mengembalikan kas ke 1000. Lock `paper/state/scan.lock` menolak dua scan bersamaan.

## Telegram

Jangan menaruh token bot di repo ini. Paper tidak memanggil `api.telegram.org` dan tidak menambah penerima. Tujuan yang sudah ada adalah `@nughairBot`; pengiriman dilakukan nanti oleh proses bot itu, yang sudah memegang token dan chat id.

Setiap baris outbox punya `"deliver": false` dan `"mode": "PAPER"`. Proses pengirim milik operator cukup membaca baris baru dan mengirim teks ke chat yang sudah terpasang. Contoh kerangka, tanpa rahasia:

```js
import fs from "node:fs";
const lines = fs.readFileSync("paper/state/outbox.jsonl", "utf8").trim().split("\n");
const event = JSON.parse(lines.at(-1));
const text = [
  "PAPER Meridian",
  event.code,
  `Kas USD ${event.cashUsd}`,
  `Ekuitas USD ${event.equityUsd ?? "tidak ditandai"}`,
  `Posisi terbuka ${event.openPositions.length}`,
].join("\n");
// Kirim `text` dengan token dan chat id yang sudah dimiliki proses @nughairBot.
```

`paper/examples/position-event.example.json` hanya skema. Itu bukan fill dan tidak boleh dimasukkan ke ledger.

## Tes

```sh
npm test
```

Itu menjalankan sintaks, tes standalone yang sudah ada, tes modul, dan `test/paper.test.js`. Paper test tidak membutuhkan jaringan.
