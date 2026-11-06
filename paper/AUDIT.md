# Audit Meridian pada `cb3a2f0`

Repositori yang diaudit: `https://github.com/Nughair/meridian`  
Commit: `cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef` (23 Oktober 2026, `feat(admin): Status shows active RPC hosts`)  
Cakupan git: 43 berkas terlacak, 8722 baris. Tidak ada berkas `LICENSE`. Tidak ada `smart-wallets.json`, `lessons.json`, atau `user-config.json` di tree. Branch `legacy` ada di remote dan tidak dimuat oleh aplikasi; isi LLM/server di branch itu tidak diaudit baris per baris.

Permalink di bawah mengarah ke commit yang diaudit.

## Cakupan baca

Dibaca utuh atau sampai jalur keputusan: `package.json`, `README.md`, `CLAUDE.md`, `config.js`, `exit-rules.js`, `cli.js`, `setup.js`, `index.js`, `standalone/screening.js`, `standalone/store.js`, `standalone/events.js`, `standalone/runtime.js`, `standalone/rpc.js`, `tools/executor.js` (gerbang deploy), `envcrypt.js` (inti kripto), bagian kunci/shadow `standalone/telegram-admin.js`, cooldown `pool-memory.js`, pembukuan `performance.js`, dan tes.

Dibaca sebagian: `tools/dlmm.js` (deploy, dry-run, claim, close), `tools/wallet.js`, `tools/pnl.js`, `state.js` (exit dan peak), `telegram.js`, `standalone/monitor.js`, `package-lock.json` (daftar dependensi, bukan setiap baris transitive). Celah: tidak setiap cabang close/claim di `tools/dlmm.js` dan tidak seluruh riwayat `legacy`.

## Strategi yang benar-benar ada

Bukan pemindai pool umum. Alurnya wallet-triggered:

1. Pantau wallet LP lewat WebSocket Solana dan backfill tanda tangan.
2. Dua wallet berbeda (atau grup) menambah likuiditas quote in-range pada mint yang sama dalam 120 detik. Deposit minimal 0,1 SOL. `removeLiquidity` / rebalance tidak dihitung sebagai entri baru.
3. Screen mint itu saja: Jupiter datapi + pool Meteora DLMM token/SOL. Peringkat pool: `fee_active_tvl_ratio`, lalu `active_tvl`, lalu alamat.
4. Cek ulang eksposur wallet, pergerakan harga maksimal 5%, saldo, lalu deploy satu sisi SOL.
5. Rentang: strategi `bid_ask`, `bins_above = 0`, `bins_below` dari volatilitas (timeframe di bawah 30 menit memakai volatilitas 30 menit), dijepit 35–69.
6. Keluar deterministik: stop -50%, take profit +5%, trailing (picu 3%, turun 1,5%, butuh 2 tick pada poller 3 detik), harga jauh di atas rentang, out-of-range 30 menit, yield fee/TVL di bawah 7 setelah umur minimum. Klaim fee jika belum diklaim >= USD 5.
7. Tidak ada transaksi rebalance di jalur standalone. Posisi yang keluar rentang ditutup.
8. Shadow mode default memaksa `DRY_RUN`. CLI tidak punya deploy manual atau scan lebar.

Ukuran live bukan USD 100. `computeDeployAmount` memakai SOL: `clamp((saldo - 0,2) * 0,35, lantai 0,5, langit 50)` lalu `toFixed(2)`.

README sesuai dengan kode ini. Tidak ada klaim win-rate atau laba di README.

## Temuan

Bug adalah perilaku kode yang menyimpang dari tujuan yang tertulis atau dari satuan yang dipakai operator. Risiko/unknown adalah hal yang belum terbukti atau bergantung pada data yang tidak ada.

### Bug

| Severity | Dampak | Lokasi |
|---|---|---|
| Tinggi | `maxDeployAmount` default 50 dibandingkan sebagai SOL. Langit efektif sekitar 50 SOL, bukan USD 50. Pada harga scan ini itu sekitar USD 4484 per posisi. | [executor.js:428](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/executor.js#L428) dan [config.js:192](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/config.js#L192) |
| Tinggi | Admin Telegram bisa mematikan shadow sehingga proses berikutnya bisa mengirim transaksi nyata, dan bisa mengirim private key ke riwayat chat. | [telegram-admin.js:441](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/telegram-admin.js#L441) dan [baris 460](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/telegram-admin.js#L460) |
| Sedang | `envrypt` adalah XOR berulang, bukan enkripsi berautentikasi. Berkas yang tampak terlindungi bisa dibalik dengan kunci di sampingnya. | [envcrypt.js:54](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/envcrypt.js#L54) |
| Sedang | `user-config.json` yang memuat `walletKey` disalin ke `WALLET_PRIVATE_KEY`. | [config.js:32](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/config.js#L32) |
| Sedang | Saat `DRY_RUN=true`, cek saldo SOL sebelum deploy dilewati. Proposal shadow bisa lolos untuk wallet yang tidak mampu membayar. | [executor.js:436](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/executor.js#L436) |
| Sedang | Jalur dry-run kembali sebelum cek inisialisasi bin-array. Proposal tidak melihat penolakan yang akan terjadi saat live. | [dlmm.js:350](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/dlmm.js#L350) dibanding [baris 381](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/dlmm.js#L381) |
| Sedang | Aturan yield di `exit-rules.js` mengunci umur 60 menit. Poller memanggil itu sesudah cek yang memakai `minAgeBeforeYieldCheck`. Menaikkan konfigurasi di atas 60 tidak menahan aturan kedua. | [exit-rules.js:49](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/exit-rules.js#L49) dan [state.js:423](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/state.js#L423) |
| Sedang | Posisi wallet yang lebarnya 70 bin atau lebih dibuang dari konfirmasi sinyal. Wallet yang dipantau dengan rentang lebar tidak pernah dihitung. | [events.js:44](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/events.js#L44) |
| Rendah | Lamport deploy dihitung dengan `Math.floor(jumlah * 1e9)`, rentan kesalahan biner. | [dlmm.js:393](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/dlmm.js#L393) |

### Risiko dan unknown

- Tidak ada bukti profitabilitas. Tidak ada riwayat posisi, `lessons.json`, atau laporan hasil di tree. Tidak bisa disimpulkan bahwa strategi ini menghasilkan uang.
- Tidak ada berkas lisensi. Dependensi di lockfile punya lisensi masing-masing (banyak MIT/Apache-2.0). Status lisensi kode aplikasi sendiri tidak tertulis.
- `npm audit` pada lockfile yang ada: 1 critical, 8 high, 8 moderate, dari 159 dependensi. Critical adalah `proxy-addr` (transitive). Entry point yang diaudit tidak membuka server HTTP, jadi jangkauan spoofing IP itu tidak terlihat. High mencakup `ws`, `bigint-buffer`, dan rantai `@solana/web3.js`. Paper tidak menambah dependensi. Ini risiko rantai pasok, bukan bukti eksploit yang dijalankan.
- Swap live memakai slippage SDK 1 persen dan tidak memasang priority fee atau relay privat. Transaksi live masuk mempool publik. Lihat [dlmm.js:446](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/tools/dlmm.js#L446).
- Referral Jupiter 50 bps ke akun tetap dipotong pada swap live. [config.js:167](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/config.js#L167).
- Skala angka `fee_active_tvl_ratio` dan `volatility` dari API Meteora tidak diverifikasi terhadap dokumentasi satuan di luar pemakaian kode. Ambang 0,05 dan pembagi volatilitas `/ 5` dipakai apa adanya.
- Biaya LLM pada `main` tidak ada. Biaya operasi live adalah RPC, polling Meteora sekitar 3 detik, dan Jupiter. Branch `legacy` memuat jalur LLM yang tidak dihitung di sini.
- Hook git di checkout ini hanya sampel. Hook Claude menolak bash background dan pembacaan `.env`. Bukan pengaman transaksi.
- Path keluar 10 menit (`manageOnce`) bisa menutup pada satu pembacaan, sementara poller cepat butuh 2 tick. Dua jalur itu tidak identik. [runtime.js:233](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/runtime.js#L233) dan [baris 269](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/runtime.js#L269).

### Yang sudah benar

- Entri butuh sinyal konvergensi. Data posisi atau saldo yang gagal dibaca tidak dianggap kosong atau bisa dibelanjakan. [runtime.js:102](https://github.com/Nughair/meridian/blob/cb3a2f0d99c4938c8f9b2e2ca164bf98495ad2ef/standalone/runtime.js#L102).
- Shadow default memaksa dry-run di semua jalur transaksi yang memuat config.
- Lantai `minBinsBelow` 35 dan deploy hanya SOL di sisi Y.
- Percobaan berstatus `submitting` tidak dipangkas dan menghalangi entri ganda sampai direkonsiliasi.
- Tes yang ada tidak mengirim transaksi. `npm test` lulus pada commit kerja paper, termasuk tes baru.

## Verdict

Cocok untuk dipelajari. Cocok untuk latihan keputusan paper hanya sebagai buku virtual yang gagal-tertutup. Tidak cocok untuk live. Tidak ada jejak laba, kunci bisa keluar lewat Telegram, satuan plafon deploy longgar, dan sinyal masuk tidak bisa dijalankan tanpa daftar wallet plus RPC baca.
