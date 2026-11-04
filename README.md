# ∞ Oneindig

Een eindeloze, procedureel gegenereerde 3D-wereld in de browser. Geen spel: de camera
zweeft zelfstandig door een zo natuurlijk mogelijk landschap dat nooit ophoudt, met een
dag- en nachtcyclus, zonneschaduwen, wolken, sterren en noorderlicht.

Open `index.html` via een (willekeurige) statische webserver, bijvoorbeeld:

```bash
python3 -m http.server 8000
```

en ga naar <http://localhost:8000>. Het werkt ook direct op GitHub Pages.

## Wat er te zien is

- **Vijf biomen** die in elkaar overlopen: De Gouden Duinen (tafelbergen, cactussen, natuurlijke
  rotsbogen), Smaragdgroene Weiden, De Bloesemvallei (stenen lantaarns), De Amberwouden
  (herfstbomen, paddenstoelen) en De Kristalvlakten (sneeuw, ijskristallen).
- **Terrein** uit simplex-ruis met domain warping, ronde bergkammen, brede rivierdalen en meren,
  met gladde normalen, holtes die donkerder zijn en procedurele bodemtextuur (graspollen, droge
  plekken, kale aarde, gelaagde rots, zandribbels, sneeuw).
- **Planten en objecten**: loofbomen, dennen, bloesembomen en struiken opgebouwd uit honderden
  losse bladclusters en naaldtakken, dicht wuivend gras rond de camera, bloemen, ruwe rotsen en
  keien met mos, staande stenen in cirkels, ruïnes van zuilen, wandelaars met lantaarns,
  vogelzwermen en hemellantaarns die 's nachts opstijgen.
- **Licht en lucht**: schaduwen van zon en maan (eigen schaduwkaart met zachte randen), licht dat
  door bladeren schijnt, procedurele wolken die met de reis meebewegen, water met golven,
  rimpelingen en zonreflectie, hoogtemist, sterren, melkweg en noorderlicht, plus
  kantenverzachting (MSAA) voor de bladeren, subtiele bloom en kleurgrading.
- **Rustige achtergrondmuziek**, live gegenereerd met de Web Audio API: zachte akkoordvlakken,
  een diepe grondtoon, belletjes met echo en galm, en een zacht windgeruis. Overdag in D-groot,
  's nachts in D-dorisch; elk bioom heeft een eigen klankkleur. Er zijn geen audiobestanden.
  Browsers laten geluid pas toe na interactie, dus de muziek begint bij de eerste klik, tik of
  toets. Je keuze (aan/uit) wordt onthouden.

## De ruimte

Via de schakelaar **Aarde · Ruimte · Wolken** rechtsboven (of op `/ruimte/`) reis je eindeloos door een
procedureel gegenereerd stuk melkweg, realistisch en zonder mensenwerk:

- **Sterrenhemel** met sterren in lagen die meeschuiven, een melkwegband met stofbanen en verre
  sterrenstelsels.
- **Plasmanevels**: volumetrische gaswolken (raymarching door een naadloze 3D-ruistextuur) in de
  kleuren van echte nevels: rode waterstof, turquoise zuurstof, blauwe reflectienevels en donkere
  stofbanen, verlicht door sterren in de buurt.
- **Sterren** van rode dwerg tot blauwe reus, met een kokend plasma-oppervlak, zonnevlekken,
  corona en protuberansen.
- **Planeten**: rots-, woestijn-, oceaan- en ijsplaneten, gasreuzen en ijsreuzen, met dampkring,
  wolken, ringen (met schaduw) en manen.
- **Asteroïdengordels** met tollende rotsen en puin, en **kometen** met ion- en stofstaart.
- **Zeldzaam**: zwarte gaten met accretieschijf en zwaartekrachtlens, pulsars met vegende stralen
  en planetaire nevels.
- **Gebieden**: De Rode Nevel, Het Blauwe Cluster, De Gordel, De Leegte en De Draaikolk, elk met
  een eigen sfeer in de muziek.

De piloot vliegt van bezienswaardigheid naar bezienswaardigheid, scheert er op een mooie afstand
langs en ontwijkt botsingen. Besturing in de ruimte: `←` `→` draaien, `Q` `E` dalen/stijgen,
`↑` `↓` of scrollen voor snelheid, `N` naar de volgende bezienswaardigheid, en verder `C`, `M`,
`H`, `F` en spatie zoals op aarde. URL-opties: `?seed=3` (startplek), `?gebied=0`–`3` (begin in
een bepaald gebied) en `?q=0.6` (lagere kwaliteit).

## Boven de wolken

De derde wereld (**Wolken** in de schakelaar, of `/wolken/`): een eindeloze vlucht boven en door
de wolken, puur wolken en lucht, zonder grond.

- **Volumetrische wolken**, doorgerekend met lichtverstrooiing: zilveren randen tegen de zon,
  zelfschaduw, gloeiende toppen bij zonsopkomst en -ondergang en een diepe wolkenlaag ver beneden.
  Een weerkaart bepaalt waar welke wolken staan: vlakke wolkenzeeën, stapelwolken, torenhoge
  onweerswolken met aambeelden en regensluiers. Elk beeld wordt gemengd met het vorige
  (tijdsfilter) voor rustige, scherpe wolken.
- **Onweer**: bliksem die wolken van binnenuit verlicht, zichtbare schichten en donder die klinkt
  met de vertraging van de geluidssnelheid (hoe verder weg, hoe later en lager).
- **Licht en lucht** uit de aardse wereld: dezelfde dag- en nachtcyclus, zon, maan, sterren,
  sluierwolken en noorderlicht, plus de **glorie**: een gekleurde ring op de wolken tegenover de zon.
- **Gebieden**: De Wolkenzee, De Torens, De Passaat, Het Poolgebied en, zeldzaam, Het Oog van een
  orkaan met een draaiende wolkenmuur.
- **Vogels** trekken in V-formatie voorbij. De piloot scheert over de toppen, duikt soms dwars
  door een wolk en houdt afstand van onweer.

Besturing zoals op aarde (`←` `→`, `↑` `↓`, `Q` `E`, `T`, `C`, `M`, `H`, `F`, spatie).
URL-opties: `?t=0.75`, `?seed=3`, `?gebied=0`–`4`, `?q=0.6`.

## Besturing

| Toets | Actie |
| --- | --- |
| `←` `→` of `A` `D` | sturen (de automatische piloot neemt het daarna weer over) |
| `↑` `↓` of `W` `S`, scrollwiel | sneller / langzamer |
| `Q` `E` | lager / hoger vliegen |
| `T` | tijd vooruitspoelen |
| `C` | bioscoopbalken |
| `spatie` | pauze |
| `H` | interface verbergen |
| `M` | muziek aan/uit (ook via de knop rechtsboven) |
| `F` | volledig scherm |

Met de muis kijk je een beetje rond; slepen (of vegen op een telefoon) stuurt.

URL-parameters: `?t=0.95` (starttijd, 0–1), `?seed=3` (startplek), `?q=0.6` (lagere kwaliteit,
zoals op telefoons) en `?noshadow` (zonder schaduwen, voor tragere computers).

## Techniek

- `js/world.js` — hoogte- en temperatuurfunctie van de wereld
- `js/terrain.js` — chunks rond de camera en deterministische verspreiding van objecten
  (één `InstancedMesh` per objecttype met dynamische pages)
- `js/models.js` — procedurele modellen (gladde vormen, bladkaarten)
- `js/grass.js` — het meeschuivende grasveld rond de camera
- `js/shadows.js` — de schaduwkaart
- `js/life.js` — alles wat beweegt
- `js/pilot.js` — de automatische camera die dalen volgt en bergen ontwijkt
- `js/audio.js` — de generatieve muziek
- `js/daycycle.js`, `js/shaders.js`, `js/ui.js`, `js/main.js`
- `wolken/` — de wolkenwereld: `weather.js` (weerkaart, gebieden, onweerscellen), `shaders.js`
  (wolkenraymarch, compositie, bliksem, vogels), `storms.js`, `pilot.js` en `main.js`
- `ruimte/` — de ruimtewereld: `noise3d.js` (3D-ruis), `universe.js` (sectoren en gebieden),
  `bodies.js` (hemellichamen), `pilot.js`, `shaders.js`, `hud.js` en `main.js`

Een *floating origin* houdt de coördinaten klein, zodat de reis echt eindeloos kan duren.
Three.js r160 zit meegeleverd in `lib/three` (MIT-licentie).
