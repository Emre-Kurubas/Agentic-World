# Ajan Dünyası

Yapay zekâ karakterlerinin kurgusal bir dünyada ülke yönettiği, tur tabanlı politika simülasyonu. Sen izlersin.

## Çalıştırma

Node.js 20 veya üstü ve oturumu açık Claude Code gerekir.

En kolayı masaüstündeki **Ajan Dünyası** kısayoluna çift tıklamak. Oyun başlar, panel kendi penceresinde açılır, pencereyi kapatınca oyun durur ve kaldığı yerden sürer. Kısayol silinirse `powershell -File kisayol-olustur.ps1` ile yeniden kurulur.

Terminalden:

```
cd Desktop\ajan-dunyasi
node run.js
```

Sonra tarayıcıda `http://localhost:4173` adresini aç. Oyun sen durdurana kadar sürer. Durdurmak için paneldeki **Oyunu durdur** düğmesini kullan. Ctrl+C ile kapatırsan bir sonraki `node run.js` kaldığı turdan devam eder.

Claude kullanmadan paneli denemek için: `node run.js --backend mock --name deneme --delay 1500`

## Hangi karakterler yapay zekâ olsun

Her ülkede lider, general, muhalefet ve oligark vardır. Seçmediklerin dünyadan silinmez, kurallarla oynar: darbe de yapabilir, ihanet de edebilirler.

```
node run.js --roles leader
node run.js --roles leader,general
```

Kalıcı yapmak için `config.json` içindeki `agentRoles` listesini değiştir. Ülkeye özel ayar için: `"countryAgentRoles": { "U1": ["leader"], "U2": ["leader", "general"] }`.

## Ayarlar (`config.json`)

- `maxTurns`: 0 sınırsızdır.
- `wakeEvery`: Yapay zekâ olan ikincil karakterlerin en geç kaç turda bir uyanacağı.
- `wakeTension`: Gerilim bu değeri geçince ikincil karakterler her tur uyanır.
- `maxLookupRounds`: Bir karakterin tur başına kaç kez bilgi sorgulayabileceği. Her sorgu turu bir ajan çağrısıdır.
- `negotiationRounds`: Aynı çeyrek içinde kaç görüşme turu yapılabileceği. 0 yaparsan mesajlar gelecek çeyreğe kalır. Her görüşme, mesaj alan her yapay zekâ karakter için bir çağrıdır.
- `models`: lider, hakem ve ikincil karakterlerin modeli.
- `concurrency`: Aynı anda çalışan ajan sayısı.
- `saveDir`: Boşsa kayıtlar OneDrive dışında `kullanıcı klasörün\ajan-dunyasi-kayitlar` altına yazılır.

Sıfırdan başlamak için: `node run.js --new`. Bu, aynı adlı kaydı siler.

## Dosyalar

- `engine/`: dünya modeli, ekonomi, ordu, siyaset, işlemler
- `agents/`: karakter ve hakem istekleri, kural tabanlı oyuncular, tur akışı, kayıt
- `panel/`: izleme ekranı. **Defter** sekmesi her şeyi aranabilir tutar, **Kişiler** sekmesi karakter başına zaman çizelgesi verir
- `agents/queries.js`: karakterlerin bakabildiği bilgiler ve erişim sınırları
- `tests/realism.js`: gerçekçilik ve sistem kontrolleri (`node tests/realism.js`)
