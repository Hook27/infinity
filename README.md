# ∞ Oneindig

Een eindeloze, procedureel gegenereerde 3D-wereld in de browser. Geen spel: de camera
zweeft zelfstandig door een low-poly landschap dat nooit ophoudt, met een dag- en
nachtcyclus, sterren, noorderlicht en een wereld vol objecten en figuren.

Open `index.html` via een (willekeurige) statische webserver, bijvoorbeeld:

```bash
python3 -m http.server 8000
```

en ga naar <http://localhost:8000>. Het werkt ook direct op GitHub Pages.

## Wat er te zien is

- **Vijf biomen** die in elkaar overlopen: De Gouden Duinen (mesa's, cactussen, zandstenen
  bogen), Smaragdgroene Weiden, De Bloesemvallei (lantaarns), De Amberwouden (herfst,
  reuzenpaddenstoelen) en De Kristalvlakten (sneeuw, gloeiende kristallen).
- **Terrein** uit simplex-ruis met domain warping, bergruggen, kronkelende rivieren en meren.
- **Objecten en figuren**: bomen, gras en bloemen die in de wind bewegen, rotsen,
  steencirkels met gloeiende runen, ruïnes, geknielde stenen kolossen, zwevende ringen,
  rondtrekkende wandelaars met lantaarns, reusachtige lopende titanen, vogelzwermen,
  zwevende eilanden en hemellantaarns die 's nachts opstijgen.
- **Shaders**: eigen GLSL voor terrein, objecten, water (golven, fresnel, zonreflectie),
  lucht (zon, maan, sterren, melkweg, noorderlicht), atmosferische hoogtemist, vuurvliegjes
  en sneeuw, plus bloom, vignet, filmkorrel en kleurgrading.
- **Rustige achtergrondmuziek**, live gegenereerd met de Web Audio API: zachte akkoordvlakken,
  een diepe grondtoon, belletjes met echo en galm, en een zacht windgeruis. Overdag in D-groot,
  's nachts in D-dorisch; elk bioom heeft een eigen klankkleur. Er zijn geen audiobestanden.
  Browsers laten geluid pas toe na interactie, dus de muziek begint bij de eerste klik, tik of
  toets. Je keuze (aan/uit) wordt onthouden.

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

URL-parameters: `?t=0.95` (starttijd, 0–1), `?seed=3` (startplek), `?q=0.6` (kwaliteit).

## Techniek

- `js/world.js` — hoogte- en temperatuurfunctie van de wereld
- `js/terrain.js` — chunks rond de camera en deterministische verspreiding van objecten
  (één `InstancedMesh` per objecttype met dynamische pages)
- `js/models.js` — procedurele low-poly modellen
- `js/life.js` — alles wat beweegt
- `js/pilot.js` — de automatische camera die dalen volgt en bergen ontwijkt
- `js/audio.js` — de generatieve muziek
- `js/daycycle.js`, `js/shaders.js`, `js/ui.js`, `js/main.js`

Een *floating origin* houdt de coördinaten klein, zodat de reis echt eindeloos kan duren.
Three.js r160 zit meegeleverd in `lib/three` (MIT-licentie).
