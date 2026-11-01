# MNS-LogScope — IIS Log Dashboard

Dashboard tanpa dependencies untuk IIS W3C access logs. Tidak memerlukan Azure subscription.

## Cara guna

1. Buka dist/index.html dalam Edge atau Chrome, atau host empat fail dalam dist/ pada static website IIS dalaman.
2. Klik Import log dan pilih satu atau beberapa fail W3C. Drag & drop turut disokong. Import menggantikan snapshot semasa.
3. Ringkasan: jumlah request, HTTP errors 4xx/5xx, average response time, P95 dan request >= 2 saat.
4. Gunakan filter masa/aplikasi untuk keseluruhan dashboard. Filter carian/status/kelajuan menapis Request explorer sahaja.
5. Klik endpoint atau status untuk tapis explorer. Klik anak panah pada request untuk butiran. Export CSV mengikut filter explorer dan tetapan masking semasa.

## Pantau folder

Dalam browser Edge/Chrome yang menyokong File System Access, buka halaman melalui HTTPS atau localhost dan klik Pantau folder. Pilih folder W3SVC2 pada komputer browser, atau folder network share yang boleh dicapai dari komputer itu. Akses folder memerlukan pilihan/izin browser oleh pengguna.

Semakan setiap 5 saat ketika halaman dibuka (background tabs boleh diperlahankan oleh browser). Fail baharu di dalam folder terus turut dibaca selepas rollover. Subfolder tidak diimbas. Aplikasi membaca semula fail yang berubah dan mengira semula data, bukan menambah salinan request setiap semakan. Pilih Henti pantau untuk berhenti dan kekalkan snapshot terakhir.

Ini monitoring dari browser, bukan Windows service 24/7. Browser mesti kekal dibuka dan dapat mengakses folder sumber. Snapshot fail yang disalin dari server tidak akan mengikut perubahan fail asal server.

## Data dan had

- Semua parsing/import berlaku dalam browser. Tiada upload, database, analytics atau external library. Data hilang apabila halaman ditutup/refreshed.
- Laman hosted bermula dengan data demo rekaan. Log sebenar tidak dimasukkan dalam source repository atau deployment.
- Nilai query dan kemungkinan ID dalam path disembunyikan secara lalai. Sembunyi ID boleh dimatikan untuk siasatan. Client IP masih dipaparkan.
- Endpoint performance sentiasa menggabungkan kemungkinan ID sebagai :id.
- Header #Fields diproses mengikut setiap fail, termasuk pertukaran header. Custom columns disokong.
- Baris rosak/tidak lengkap dilaporkan dan dilangkau. Fail tanpa header #Fields tidak diteka.
- Waktu W3C ditafsir sebagai UTC; default MYT (UTC+8). Filter terakhir berpandukan request paling baharu dalam semua log.
- 25 MB setiap fail, 100 MB setiap import/scan, maksimum 100 fail. Dalam mod folder, 100 fail terkini diutamakan. Fail yang dilangkau dipaparkan sebagai notis.
- Tiada deduplikasi antara fail berlainan: elakkan import salinan fail log yang sama.
- Status 0 dilabel berasingan daripada HTTP success/error. time-taken yang tiada tidak dianggap 0.
- Access logs sahaja tidak membuktikan uptime atau memberi application exception stack trace.

## Fail aplikasi

- dist/index.html
- dist/styles.css
- dist/parser.js
- dist/app.js

Boleh disalin terus ke folder static website IIS. Untuk Pantau folder, gunakan HTTPS dengan sijil sah atau localhost.

## Pengesahan

Jalankan `npm test` menggunakan Node.js untuk menguji parsing header W3C, kolum tambahan/bertukar susunan, baris tidak lengkap, statistik masa respons, masking dan export CSV menggunakan data rekaan sahaja. Aplikasi boleh digunakan tanpa Node.js; runtime ini hanya diperlukan untuk ujian.

Paparan filter, susunan request dan masking telah disemak secara manual. Logik pantau folder telah disemak melalui simulasi append dan rollover. Dialog pemilihan fail/folder dan sambungan folder IIS sebenar memerlukan semakan pada browser/persekitaran sasaran.
