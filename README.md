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

Een *floating origin* houdt de coördinaten klein, zodat de reis echt eindeloos kan duren.
Three.js r160 zit meegeleverd in `lib/three` (MIT-licentie).
