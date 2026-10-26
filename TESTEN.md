# Zo test je het op je telefoon

Doe dit eerst met de **testkopie** van de Sheet. Houd de Sheet op je laptop open, zodat je ziet wat er gebeurt.

## Installeren
- [ ] Open de geheime link in **Safari** (iPhone) of **Chrome** (Android). Je ziet het pincodescherm.
- [ ] Voer de pincode in. Een foute pincode geeft "Verkeerde pincode."
- [ ] Kies "Ik ben Erisa" of "Ik ben Cas".
- [ ] iPhone: Deel → "Zet op beginscherm". Android: menu → "App installeren".
- [ ] Open de app vanaf het beginscherm: hij opent zonder adresbalk, met het bonnetjes-icoon.

## Home klopt met het Dashboard
- [ ] Erisa: over te maken **€ 895,96**. Cas: **€ 1.019,58**.
- [ ] Netto onderling: Cas betaalt Erisa **€ 457,19**.
- [ ] Bij Cas staat de rode regel "Podimo opzeggen (dringend)".
- [ ] Leefkosten € 1.723,03, buffer € 260,00 (Erisa € 118,00 · Cas € 142,00), netto ingelegd € 138,20.
- [ ] Titel en datum zijn "Oktober afrekening" en "26 oktober 2026".

## Betalen
- [ ] Betalen → Kopieer: het bedrag staat op het klembord.
- [ ] Open Revolut: de Revolut-app opent (of app.revolut.com).
- [ ] Als Cas: "Betaal Erisa" opent revolut.me/erisaborova. **Noteer of het bedrag al ingevuld is.**
- [ ] Als Erisa: "Stuur betaalverzoek" opent het deelmenu met de link.
- [ ] "Overgemaakt, vink af": in Te doen staat bij die regel kolom F op Ja.

## Voorschot (testrij; wis hem na afloop in de Sheet)
- [ ] Verrekenen → + Voorschot toevoegen → ZAR, bijvoorbeeld 100,00, omschrijving "TEST".
- [ ] Controleren toont wat het naar rato betekent; Opslaan zet binnen een paar seconden een rij in
      Voorschotlog, met in kolom D de formule `=100/'Budget'!$B$16`.
- [ ] Op Home is het netto onderling veranderd.
- [ ] Tik twee keer snel op "Ja, opslaan": er komt maar één rij.
- [ ] "Markeer als terugbetaald" zet de datum van vandaag in kolom E.
- [ ] Wis de testrij (A:E) daarna zelf in de Sheet.

## Declaratie
- [ ] + Declaratie toevoegen (Benzine, TEST): er komt een rij in Declaraties (A:F).
- [ ] Stap 1 en stap 2 afvinken zet de datum in G en H; de status in kolom I verandert mee.
- [ ] Bij een voorschot staat "Is dit voor werk?" standaard op **Nee**: benzine wordt nooit vanzelf een declaratie.
- [ ] Wis de testrij daarna zelf.

## Offline
- [ ] Zet de vliegtuigstand aan en open de app: je ziet de laatste stand en een melding.
- [ ] Probeer iets af te vinken: je krijgt "Je bent offline. Opslaan kan pas als je weer verbinding hebt."
- [ ] Zet de vliegtuigstand uit en trek omlaag: de stand ververst.

## Cas
- [ ] Cas opent de link op zijn telefoon zonder Google-, Claude- of Revolut-inlog in de app.

Werkt alles? Herhaal dan stap 2 van de README (Apps Script) in het **echte** bestand. Daar komt een nieuwe
`/exec`-URL uit, en dus een nieuwe geheime link.
