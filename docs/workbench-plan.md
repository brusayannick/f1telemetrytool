# Workbench — Layout- und Feature-Plan

Status: Entwurf v2. Beschreibt Layout, Struktur und Verhalten der Workbench.
Kein Code — bewusst als Spezifikation, damit Umsetzung und Prüfung darauf aufbauen können.
Auslieferung: **eine Phase**, alles zusammen.

---

## 0. Zweck

Die Workbench ist ein **Analysewerkzeug für Telemetrie**, kein Dashboard. Sie beantwortet
Fragen wie „wo verliert dieser Fahrer Zeit", „was genau macht er in Kurve 9 anders",
„ist dieser Ausreißer echt oder ein Datenfehler". Sie zeigt **Daten**, nicht Zusammenfassungen.

Die Landing-Page bleibt Marketing und erklärt. **Der einzige Weg in die Daten ist der
Button „Open workbench".** Keine Chart-Vorschau auf der Landing, keine toten Links.

---

## 1. Prinzipien

1. **Daten zuerst.** Der Lane-Stapel ist das Zentrum der Seite und bekommt die volle
   Breite. Navigation, Filter und Metadaten sind schmale Leisten, nie Spalten, die dem
   Plot Platz nehmen.
2. **Ein Kanal pro Lane.** Zwei Signale teilen sich nie eine Nulllinie. Unterschiedliche
   Einheiten auf einer Achse sind verboten, nicht „mit zwei Achsen gelöst".
3. **Provenienz ist sichtbar.** Gespeicherte und berechnete Kanäle sind unterscheidbar
   markiert (`*`). Jede Zahl ist auf eine Quelle zurückführbar.
4. **Unsicherheit wird gezeigt, nicht versteckt.** Abtastlücke, fehlende Samples und
   unzuverlässige Ableitungen stehen im UI, nicht nur im Kopf des Entwicklers.
5. **Nichts wird gezeigt, was nicht gemessen wurde.** Lieber eine Lane weglassen als
   eine Kurve erfinden.

---

## 2. Informationsarchitektur

```
/                       Landing — Marketing, ein CTA: „Open workbench"
/workbench              Einstieg: Saisons → Events → Sessions  (bisher /seasons)
/workbench/[year]       Event-Liste einer Saison
/workbench/session/[id] Session-Workbench  ← Kernansicht
/workbench/compare      Zwei-Runden-Vergleich (bisher .../compare)
```

Regeln:
- Die Landing ist die **einzige** Seite mit erklärendem Text. Ab `/workbench` gilt
  Mono-Typografie, `tabular-nums`, dichte Zeilen, keine Marketing-Flächen.
- Breadcrumb zeigt immer den Pfad `Saison · Runde · Event · Session`.
- Der Zustand der Session (Ingest-Status, Telemetrie-Abdeckung) steht in der Kopfleiste,
  nicht in einem Banner.

---

## 3. Layout

### 3.1 Session-Workbench (Kernansicht)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← workbench   2025 · R24 · Abu Dhabi · Qualifying   [complete]  tel 20/20  cmp→│  Kopfleiste
├───────────────────────────────────────────────────────────────────────────────┤
│ driver │ [P1 VER][P2 NOR][P3 PIA] …                                            │  Leiste 1
│ lap    │ [17 1:22.207 fast][16 1:22.408][15 …]                         cmp →   │  Leiste 2
├───────────────────────────────────────────────────────────────────────────────┤
│ ◀ ▶ copy │ sample 1 · dist 8 m · t 0:00.131 · lap 1:22.207 · n 615 ·          │  Cursor-Readout
│          │ Δs 137 ms · max Δs 1000 ms · len 5.229 km · lanes 12               │
├───────────────────────────────────────────────────────────────────────────────┤
│ SPEED THR BRK RPM GEAR DRS GAP ACC ELEV COAST TRAIL PROG      ← / → step 1    │  Lane-Schalter
├───────────────────────────────────────────────────────────────────────────────┤
│ SPEED     104 │ 243.6 km/h   ┌───────────────────────────────────────────┐    │
│               │              │        ╱╲      ╱╲                        │    │
│               │              │   ╱╲__╱  ╲___╱  ╲__                     │    │
│               │              └───────────────────────────────────────────┘    │
│ THROTTLE   62 │ 100.0 %      ┌───────────────────────────────────────────┐    │
│               │              │ ▔▔▔▔▔▔▔▔╲___▔▔▔▔▔▔▔▔▔▔╲___▔▔▔▔▔▔▔▔▔▔▔▔▔    │    │
│               │              └───────────────────────────────────────────┘    │
│ BRAKE      54 │   0.0 %      ┌───────────────────────────────────────────┐    │
│               │              │      ▔▔▔▔▔▔      ▔▔▔▔▔▔                   │    │
│               │              └───────────────────────────────────────────┘    │
│ RPM        70 │ 10927.6 rpm  ┌───────────────────────────────────────────┐    │
│ GEAR       50 │   6.0 gear   ┌───────────────────────────────────────────┐    │
│ DRS        44 │   8.0        ┌───────────────────────────────────────────┐    │
│ GAP AHEAD  52 │ 2003.0 m     ┌───────────────────────────────────────────┐    │
│ ACCEL      66 │  10.4 m/s²   ┌───────────────────────────────────────────┐    │
│ ELEV       44 │ -24.0 m      ┌───────────────────────────────────────────┐    │
│ COAST      36 │   0.0 %      ┌───────────────────────────────────────────┐    │
│ TRAIL      36 │   0.0 %      ┌───────────────────────────────────────────┐    │
│ PROGRESS   36 │  97.0 %      └───────────────────────────────────────────┘    │
├───────────────────────────────────────────────────────────────────────────────┤
│ 0.00 km        1.00 km        2.00 km        3.00 km        4.00 km   5.00 km │  Distanzachse
├───────────────────────────────────────────────────────────────────────────────┤
│ channel │ min  at │ max  at │ mean │ σ │ duty │ gaps                            │  Statistik
│ Speed   │ 68.0 2634│331.0 2421│229.9 │67.9│100% │ 0                            │
│ Brake   │  0.0    0│100.0  308│ 14.2 │34.9│ 14% │ 0                            │
│ …                                                                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

Merkmale:
- **Volle Breite** für den Stapel. Keine linke Navigationsspalte.
- **Linke Gutter** (Kanalname + Live-Wert + Einheit) ist über alle Lanes gleich breit
  (~200 px), damit die Plots exakt untereinander liegen.
- **Achsen-Gutter** ~54 px für die y-Werte, ebenfalls in allen Lanes identisch.
- Nur die **unterste Lane** beschriftet die Distanzachse. Alle Lanes darüber zeichnen das
  Gitter, damit eine Distanz überall ablesbar bleibt.
- Der Cursor ist **eine vertikale Linie durch alle Lanes** — ein Feature in einer Lane
  liegt vertikal über seiner Ursache in einer anderen.

### 3.2 Compare-Workbench

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ A: VER L17 1:22.207      B: NOR L16 1:22.408      official gap +0.201 s        │
├───────────────────────────────────────────────────────────────────────────────┤
│ DELTA        │  ┌───────────────────────────────────────────────────────┐      │  Δt-Lane (gefüllt)
│              │  │      ▁▁▂▃▅▇█▇▅▃▂▁▁                                    │      │
├───────────────────────────────────────────────────────────────────────────────┤
│ SPEED        │  A ────╱╲────  B ─ ─ ─╱╲── ─    (zwei Linien, eine Lane)  │      │
│ THROTTLE     │  A ────▔▔▔▔    B ─ ─ ─▔▔▔▔                               │      │
│ BRAKE        │  A ────▔▔      B ─ ─ ─▔▔                                │      │
│ …            │                                                              │      │
├───────────────────────────────────────────────────────────────────────────────┤
│ TRACK        │  Streckenkarte, Segmente nach lokaler Δt-Rate gefärbt       │      │
├───────────────────────────────────────────────────────────────────────────────┤
│ CORNER       │ T1 … T16: apex Δ, brake Δ, exit Δ, time Δ  (eine Zeile je Kurve)│    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Regeln für Compare:
- **Zwei Fahrer in einer Lane** ist hier erlaubt und gewollt — es ist derselbe Kanal.
  Farbe A durchgezogen, B gestrichelt, identische Skala.
- Die **Delta-Lane steht ganz oben**, weil sie die Frage beantwortet, bevor man Details
  sucht.
- Der **offizielle Zeitabstand** aus den Timing-Daten ist die Autorität. Der Δ-Trace endet
  dort, wo die Telemetrie endet, und wird mit seiner Distanz beschriftet — die Differenz
  beträgt bis zu ein Sample (~137 ms bei 7.3 Hz) und ist nicht behebbar.

### 3.3 Workbench-Einstieg

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ WORKBENCH                                                                     │
│ ┌ Saison ──────────────────────────────┐ ┌ Sessions ─────────────────────────┐│
│ │ 2025  ▸                              │ │ FP1 FP2 FP3 Q  R   20/20 drivers   ││
│ │ 2024  ▸                              │ │ status: complete · corners 16      ││
│ └──────────────────────────────────────┘ └───────────────────────────────────┘│
│ R24 Abu Dhabi · Qualifying     [open]   telemetry 20/20 · corners 16           │
└───────────────────────────────────────────────────────────────────────────────┘
```
Dichte Listen statt Karten. Status je Session direkt sichtbar (ingest, Abdeckung, Kurven).

---

## 4. Lane-Anatomie

### 4.1 Aufbau

| Teil | Inhalt | Zweck |
|---|---|---|
| Farbmarke | 3 px Linie in Kanalfarbe | Zuordnung ohne Legende |
| Kanalname | `SPEED`, `BRAKE` … (`*` bei berechnet) | was hier steht |
| Live-Wert | Wert am Cursor, `tabular-nums` | Zahl statt Schätzung |
| Einheit | `km/h`, `%`, `rpm` | Einheiten nie raten |
| Herkunft | „stored channel" / „derived: d(speed)/dt" | Provenienz |
| Plot | uPlot mit eigener y-Skala | das Signal |
| Grid | vertikal über alle Lanes, horizontal je Lane | Ablesbarkeit |

### 4.2 Lane-Reihenfolge, Höhen, Einheiten

| # | Lane | Einheit | Höhe | Skala | Anmerkung |
|---|---|---|---|---|---|
| 1 | Speed | km/h | 104 | fix 0–350 | trägt die Form der Runde |
| 2 | Throttle | % | 62 | fix 0–100 | Fläche unterlegt |
| 3 | Brake | % | 54 | fix 0–100 | diskret (0/100) |
| 4 | RPM | rpm | 70 | fix 0–15000 | |
| 5 | Gear | gear | 50 | fix 0–8 | diskret, Stufen |
| 6 | DRS | 0–14 | 44 | fix 0–14 | diskret |
| 7 | Gap ahead | m | 52 | **datenabhängig** (90. Perzentil) | NaN wenn führend |
| 8 | Acceleration | m/s² | 66 | fix −6…6 | berechnet aus Speed |
| 9 | Elevation | m | 44 | **datenabhängig** (z min/max) | |
| 10 | Coasting | % | 36 | fix 0–100 | berechnet, 0/100 |
| 11 | Trail braking | % | 36 | fix 0–100 | berechnet, 0/100 |
| 12 | Lap progress | % | 36 | fix 0–100 | |

Regeln:
- **Fixe Skalen** für physikalisch begrenzte Kanäle — sonst sieht jede Runde „gleich" aus.
- **Datenabhängige Skalen** nur wo die Größe von der Strecke abhängt (Höhe, Verkehr).
- Nicht vorhandene Kanäle werden **weggelassen**, nie als Nulllinie gezeichnet.
- Höhen sind absichtlich unterschiedlich: Speed braucht Form, Gear nur eine Stufe.

### 4.3 Diskret vs. kontinuierlich

| Typ | Kanäle | Darstellung |
|---|---|---|
| kontinuierlich | speed, rpm, accel, elev, gap, progress | Linie, ggf. Fläche |
| diskret | brake, gear, drs, coast, trail | Stufen (stepped), keine Interpolation zwischen Samples |

Begründung: Ein Bremskanal, der zwischen 0 und 100 interpoliert, behauptet Zwischenwerte,
die es nicht gibt. Ein Gang von 5 auf 6 ist ein Sprung, keine Rampe.

---

## 5. Interaktion

### 5.1 Cursor und Readout

- Vertikale Linie in **allen** Lanes synchron, Distanz als gemeinsame Abszisse.
- Readout zeigt pro Sample: `sample`, `dist`, `t` (Rundenzeit), sowie in jeder Lane den
  Live-Wert.
- **Sample-Schrittsteuerung** (`◀` / `▶`, Pfeiltasten, Shift = 10) — der einzige Weg, einen
  exakten Wert aus einem 7.3-Hz-Signal zu lesen. Die Maus landet nur auf wenige Meter genau.

### 5.2 Zoom und Pan

- Ziehen horizontal = Zoom auf Distanzbereich, **wirkt auf alle Lanes**.
- Doppelklick = Reset auf ganze Runde.
- Presets: „ganze Runde", „Kurve n ± 150 m", „letzte 500 m".
- Beim Zoomen bleibt die Sample-Schrittweite erhalten (Index, nicht Pixel).

### 5.3 Tastatur

| Taste | Wirkung |
|---|---|
| `←` / `→` | ein Sample zurück/vor |
| `Shift + ←/→` | zehn Samples |
| `Home` / `End` | Anfang/Ende der Runde |
| `+` / `-` | Zoom um den Cursor |
| `0` | Zoom zurücksetzen |
| `1`…`9` | Lane ein/aus |
| `c` | Sample als TSV kopieren |

### 5.4 Copy und Export

- **Copy Sample (TSV)**: Kopfzeile `sample, distance_m, elapsed_ms, <key>[<unit>]…`,
  eine Zeile Werte. Für Tabellenkalkulation und Issue-Reports.
- **Copy Range**: markierter Distanzbereich als TSV-Spalten.
- **Export PNG** der Lane (uPlot `toDataURL`) für Dokumentation.
- Alle Werte mit `NaN` bleiben `NaN` — fehlende Daten werden nicht zu 0.

---

## 6. Features

Jeweils: Zweck, Verhalten, Abnahmekriterium.

### 6.1 Ansicht und Interaktion

### F1 — Lane-Stapel (Kern)
**Zweck:** Alle Kanäle gleichzeitig, vertikal ausgerichtet.
**Verhalten:** eine Lane pro Kanal, gemeinsame Distanzachse, synchroner Cursor, Zoom
wirkt überall.
**Abnahme:** 12 Lanes bei vollständigem Payload; keine Lane zeigt zwei Einheiten; ein
Feature bei 2.4 km liegt in allen Lanes auf derselben Vertikalen.

### F2 — Cursor-Readout mit Schrittsteuerung
**Zweck:** exakte Werte statt Schätzungen.
**Verhalten:** `◀`/`▶`, Pfeiltasten, Shift; Werte in den Lane-Kopfzeilen laufen mit.
**Abnahme:** drei Schritte erhöhen `sample` um 3 und `dist` um die Distanz dieser Samples.

### F3 — Kanal-Statistik
**Zweck:** Verteilung und Extreme ohne Suchen.
**Verhalten:** min/max mit der Distanz des Extremwerts, Mittelwert, σ, Duty (Anteil > 0),
Anzahl Lücken — für genau die sichtbaren Kanäle.
**Abnahme:** Werte stammen aus derselben Funktion, die die Lane zeichnet; Tabelle und Plot
können nicht widersprechen.

### F4 — Lane-Schalter und Presets
**Zweck:** Ansicht auf die Frage zuschneiden.
**Verhalten:** ein Schalter je Lane, mindestens eine bleibt an; Presets „Antrieb",
„Fahrereingaben", „Qualität".
**Abnahme:** abgeschaltete Lane verschwindet vollständig; die letzte Lane lässt sich nicht
abschalten.

### F5 — Datenqualität sichtbar
**Zweck:** Fehler von Signalen unterscheiden.
**Verhalten:** je Lane ein Qualitätsindikator: Anzahl Lücken, größter Sample-Abstand,
Spitzenausreißer. Ausreißer sind markierbar und in der Statistik als Ausreißer
gekennzeichnet.
**Abnahme:** der verifizierte Feed-Artefakt (Auto 14, Abu Dhabi Q Runde 8: Bremsduty 1.00
über zwei Segmente à ~520 m bei normaler Rundenzeit und normalem Speed-Profil) ist sichtbar
und benannt.
**Nicht als Ausreißer zählen:** die Beschleunigungsspitze −59 m/s² (−6,0 g) bei 2532 m in
Abu Dhabi Q Runde 17. Das ist eine echte Vollbremsung — Bremse 100, Gas 100 → 0,
331 → 164 km/h; F1 bremst mit 5–6 g. Siehe Befund B1.

### F6 — Kurven-Annotation
**Zweck:** „Kurve 9" statt „bei 3.2 km".
**Verhalten:** Kurvenmarken aus der kuratierten Datenbank als Linien in allen Lanes; Lane
„Kurve" mit Nummern. Fällt auf Erkennung aus dem Speed-Profil zurück, wenn keine Datenbank
existiert — dann `C1…Cn` statt offizieller Nummern, sichtbar unterschieden.
**Abnahme:** 16 Kurven bei Abu Dhabi; bei fehlender Datenbank ≥ 5 erkannte Bremszonen, und
die UI sagt, dass es erkannte und keine offiziellen Kurven sind.

### F7 — Delta-Lane (Compare)
**Zweck:** die Frage „wo" sofort beantworten.
**Verhalten:** Δt über Distanz, gefüllt, oberste Lane; offizieller Abstand als Zahl.
**Abnahme:** Δt-Lane und Statistik nutzen denselben Trace; der offizielle Abstand ist
getrennt ausgewiesen und als exakt gekennzeichnet.

### F8 — Corner-by-Corner-Tabelle (Compare)
**Zweck:** Befund statt Diagramm.
**Verhalten:** je Kurve Scheitelgeschwindigkeit A/B/Δ, Bremspunkt-Δ (m), Ausgangs-Δ, Zeit-Δ.
Nicht verifizierbare Zeilen markiert.
**Abnahme:** Kurven mit Scheitel an fallender Abschnittskante werden übersprungen, nicht
mit fremdem Minimum berichtet (Abu Dhabi T11).

### F9 — Streckenkarte
**Zweck:** räumlicher Kontext zum Δt.
**Verhalten:** Umriss aus x/y, Segmente nach **lokaler** Δt-Rate gefärbt (nicht kumulativ),
S/F-Marke, Legende.
**Abnahme:** kumulative Färbung ist verboten — sie malt die ganze Strecke in einer Farbe.

### F10 — Verkehrskontext
**Zweck:** „langsam wegen Verkehr" von „schlecht gefahren" trennen.
**Verhalten:** `Gap ahead` als Lane, und als Filter für jede Bewertung von Rundenzeit.
**Abnahme:** eine Runde hinter einem anderen Auto wird nicht als Fahrfehler bewertet.

### F11 — Anomalie-Overlay (blockiert)
**Zweck:** Auffälligkeiten finden.
**Verhalten:** Marker auf der betroffenen Lane, mit Begründung; nur bei ausreichender
Baseline; **nicht** in der Datenbank persistiert, solange nicht validiert.
**Abnahme:** kein Score wird gespeichert oder als Badge gezeigt, bevor er Verkehrskontext
und Baseline-Regeln besteht. Ein Score im UI liest sich als Autorität — er muss sie
verdienen.

### F12 — Teilen
**Zweck:** Befunde weitergeben.
**Verhalten:** URL trägt Session, Fahrer, Runde, Zoombereich, aktive Lanes, Referenzwahl
und alle vom Standard abweichenden Einstellungen.
**Abnahme:** ein kopierter Link öffnet exakt dieselbe Ansicht **und** dieselben Zahlen.

### F44 — Einstellungsmenü
**Zweck:** die Parameter, die das Ergebnis wirklich verändern, an einer Stelle bedienbar
machen — statt sie im Code zu verstecken.
**Verhalten:** Menü aus jeder Ansicht erreichbar (`s` oder Zahnrad). Gruppiert nach
Themen, je Parameter aktueller Wert, Standard, Wirkung in einem Satz und die betroffenen
Features. Abweichungen vom Standard sind hervorgehoben, je Gruppe zurücksetzbar. Vier
benannte Voreinstellungen (Abschnitt 7.3) setzen Bündel.
**Abnahme:** kein Parameter im Menü ohne Wirkungsbeschreibung; die Kopfleiste zeigt die
Zahl aktiver Abweichungen; jeder Export nennt die verwendeten Einstellungen.

---

### 6.2 Auswertung

Diese Features machen aus Kanälen **Befunde**. Alle arbeiten auf einer gemeinsamen
Zerlegung (Abschnitt 6.3) und geben immer die Stichprobengröße mit an.

#### A — Rundenzerlegung

### F13 — Segment-Zeiten
**Zweck:** „wo verliere ich Zeit" beantworten, bevor man Details sucht.
**Verhalten:** die Runde wird in Segmente zerlegt. **Festgelegt:** kurvenbasiert ist der
Standard (Bremsbeginn → Kurvenausgang; die Geraden dazwischen werden eigene
Geradensegmente), das feste 100-m-Raster ist eine umschaltbare Vergleichsansicht für
streckenübergreifende Betrachtung. Je Segment die Zeit, sortierbar, als Balken über der
Distanzachse.
**Abnahme:** Summe der Segmentzeiten = **Telemetrie-Span** (nicht die offizielle Rundenzeit
— siehe B3), exakt; Segmente lückenlos und überlappungsfrei; im Rastermodus teilen sich
Kurven, die enger als ein Rasterfeld beieinander liegen, ein Segment — das ist sichtbar so
benannt. **Stand:** kurvenbasierter Modus, Balken und sortierbare Zeitspalte umgesetzt und
verifiziert; der 100-m-Rastermodus ist offen.

### F14 — Kurven-Phasenzerlegung
**Zweck:** eine Kurve ist drei Manöver, nicht eines.
**Verhalten:** je Kurve die Phasen **Bremsen**, **Scheitel**, **Ausgang**, abgegrenzt aus
Pedalzustand und Geschwindigkeitsminimum; je Phase Dauer, Distanz und Geschwindigkeit an
den Grenzen.
**Abnahme:** Phasengrenzen sind reproduzierbar; eine Kurve ohne Bremsung hat keine
Bremsphase (nicht eine mit Dauer 0).

### F15 — Δt-Zerlegung nach Ursache
**Zweck:** aus „0,14 s verloren" wird „später gebremst, aber weniger Scheitelspeed".
**Verhalten:** je Kurve wird das Zeitdelta aufgeteilt in Beiträge aus Bremspunkt,
Scheitelgeschwindigkeit und Ausgangsgeschwindigkeit. **Festgelegt:** der Rest wird nicht
in die Beiträge hineingerechnet, sondern als eigene Zeile **„nicht zugeordnet"**
ausgewiesen. Die Zerlegung wird nie gezwungen, sich exakt aufzuteilen.
**Abnahme:** `Σ Beiträge + nicht zugeordnet = gemessenes Kurven-Δt` (Toleranz 1 Sample);
der Rest ist immer sichtbar, auch wenn er null ist; alle vier Zeilen sind als **Modell**
gekennzeichnet, nicht als Messung.

### F16 — Rangliste der Zeitverluste
**Zweck:** die drei Kurven finden, die die Runde entschieden haben.
**Verhalten:** Kurven absteigend nach Δt-Beitrag, je Zeile eine Erklärzeile
(„−0,14 s: 8 m früher gebremst, 6 km/h weniger am Scheitel").
**Abnahme:** Rangfolge nutzt denselben Δ-Trace wie die Delta-Lane — kein zweiter Rechenweg.

### F17 — Theoretische Beste Runde
**Zweck:** das Potenzial im eigenen Datensatz zeigen.
**Verhalten:** beste Segmentzeit je Segment über alle Runden des Fahrers kombiniert →
theoretische Rundenzeit, Abstand zur tatsächlich besten Runde, je Segment die Runde, die
sie beigesteuert hat.
**Abnahme:** theoretische Zeit ≤ beste Runde; Runde je Segment nachvollziehbar angegeben.

### F18 — Segment-Matrix
**Zweck:** Muster über eine ganze Session sehen.
**Verhalten:** alle Runden × alle Segmente als Heatmap der Abweichung zur besten
Segmentzeit; Zellen mit Verkehr oder Boxenfahrt markiert.
**Abnahme:** jede Zelle zeigt den Wert beim Überfahren; gefilterte Runden sind sichtbar
ausgegraut, nicht stillschweigend entfernt. **Stand:** umgesetzt — 13 Runden × 24 Segmente
auf Abu Dhabi Q, Spaltenminimum nur aus sauberen Runden, gefilterte Zeilen ausgegraut mit
Grund („traffic <300 m"), nicht bestätigte Kurven als „–" statt als fremder Wert.
Kosten: **ein** Telemetrie-Fetch, siehe B16.

#### B — Konsistenz und Verteilung

### F19 — Scheitel-Konsistenz
**Zweck:** wo ist der Fahrer unruhig, wo sicher.
**Verhalten:** je Kurve Verteilung der Scheitelgeschwindigkeit über alle gültigen Runden:
Median, MAD, Spannweite, n.
**Abnahme:** robuste Kennzahlen (Median/MAD), nicht Mittelwert/σ; n wird immer gezeigt.

### F20 — Bremspunkt-Streuung
**Zweck:** Bremskonstanz und späte Bremsversuche erkennen.
**Verhalten:** je Kurve die Bremspunkte aller Runden als Streuung über der Distanz, mit
Median und Spannweite.
**Abnahme:** Runden ohne Bremsung fließen nicht ein; Ausreißer sind markiert, nicht entfernt.

### F21 — Rundenzeit-Streuung je Sektor
**Zweck:** wo verliert man über viele Runden am meisten.
**Verhalten:** je Sektor und Segment Quartile der Zeit über alle gültigen Runden.
**Abnahme:** ungültige Runden (Box, ungenau, Verkehr) sind ausgeschlossen und die
Ausschlusszahl steht daneben. **Stand:** umgesetzt als **Sektor-Quartile** aus den
offiziellen Sektorzeiten — n, min, Q1, Median, Q3, IQR, Spanne, langsamste Runde je Sektor.
Gemessen auf Abu Dhabi Q, Fahrer 1: 6 von 18 Runden zählbar, 12 ausgeschlossen (Box,
ungenau, Gelb/SC). Die Quartile: S1 IQR **0,097 s**, S2 **0,169 s**, S3 **0,342 s** — die
Unruhe liegt im letzten Drittel, was eine andere Debrief ist als „die Runde war 0,4 s weg".
**Zwei Lücken, benannt statt versteckt:** der **Verkehrsfilter fehlt** in dieser Tabelle
(er braucht den `ahead`-Kanal aus der Telemetrie; die Tabelle liest absichtlich nur
Timing-Zeilen und kostet keinen Fetch — die UI sagt das), und die **Segment-Quartile** aus
dem Verhalten sind offen. Siehe B19.

### F22 — Ausreißer-Scatter
**Zweck:** echte Fehler von Streuung trennen.
**Verhalten:** je Kurve Scheitelgeschwindigkeit gegen Rundenzeit, Ausreißer nach
MAD-Regel markiert, Klick springt zur Runde.
**Abnahme:** die Ausreißerregel ist im UI benannt.

#### C — Fahrereingaben

### F23 — Gasannahme
**Zweck:** „wie früh kommt er zurück ans Gas" — oft die halbe Runde.
**Verhalten:** je Kurve Distanz und Zeit vom Scheitel bis 100 % Throttle; Verteilung über
die Runden.
**Abnahme:** Kurven, die nie 100 % erreichen, sind als solche ausgewiesen.

### F23 — Gasannahme
**Zweck:** „wie früh kommt er zurück ans Gas" — oft die halbe Runde.
**Verhalten:** je Kurve Distanz und Zeit vom Scheitel bis 100 % Throttle; Verteilung über
die Runden.
**Abnahme:** Kurven, die nie 100 % erreichen, sind als solche ausgewiesen. **Stand:**
umgesetzt im Konsistenz-Panel — Median und Spanne der Distanz Scheitel → 100 % Gas, n, und
die Runden, die hier nie Vollgas erreichen, namentlich ausgewiesen statt als 0 m gezählt.
Gemessen: T1 43,1 m, T5 48,8 m, T2/T3/T4 0,0 m (Vollgas ab Scheitel) — plausibel für eine
Haarnadel gegen schnelle Knicks. **Offen:** die Zeitkomponente (Distanz ist da, Zeit nicht)
und die Verteilung über die Runden statt nur Median und Spanne.

### F24 — Bremsdauer und Trail-Anteil
**Zweck:** Bremsstil vergleichbar machen.
**Verhalten:** je Kurve Bremsdauer, Bremsweg, Anteil der Runde unter Bremsung, Anteil mit
Gas-Überschneidung (Trail).
**Abnahme:** der Kanal ist binär (0/100) — es wird ausschließlich Dauer und Anteil
berichtet, **keine Bremsdruck-Analyse** (siehe 7.2).

### F25 — Schaltpunkte
**Zweck:** Übersetzung, Fahrbarkeit, Schaltfehler.
**Verhalten:** RPM beim Hochschalten, Anzahl Schaltvorgänge je Runde, Gänge je Kurve,
Verteilung der Schalt-RPM.
**Abnahme:** Schaltvorgang = Gangwechsel zwischen zwei Samples; kein Schalten über eine
Lücke hinweg gezählt.

### F26 — Gang- und RPM-Histogramm
**Zweck:** Zeitanteile statt Augenmaß.
**Verhalten:** Zeitanteil je Gang und je RPM-Band, je Runde und als Session-Summe.
**Abnahme:** Summe der Zeitanteile = Rundenzeit ± 1 Sample.

### F27 — DRS-Nutzung
**Zweck:** Aktivierungszonen und Nutzungsgrad.
**Verhalten:** Zonen mit DRS aktiv, Dauer, Anteil der Runde; Vergleich über Runden.
**Abnahme:** Wertebereich des Kanals wird korrekt gelesen (0–14, nicht nur 0/1).

### F28 — Lift-and-Coast
**Zweck:** Spritsparen und Reifenmanagement sichtbar machen.
**Verhalten:** Ereignisse mit Gas < 2 % und Bremse 0, mit Position, Dauer und Distanz.
**Abnahme:** Ereignisse unterhalb der Sample-Auflösung werden nicht gezählt (Mindestdauer
2 Samples).

#### D — Pace, Stint, Verkehr

### F29 — Stint-Pace und Reifenabbau
**Zweck:** die Frage jeder Rennanalyse.
**Verhalten:** Rundenzeit gegen Reifenalter je Stint und Compound, Regressionsgerade,
Abbau in s/Runde, R², n.
**Abnahme:** nur gültige Runden; Regression erst ab n ≥ 8, sonst nur die Punkte ohne
Gerade; R² und n stehen immer dabei.

### F30 — Verkehrsbereinigte Pace
**Zweck:** „langsam wegen Verkehr" von „langsam gefahren" trennen.
**Verhalten:** Runden mit kleinem `ahead` werden markiert und optional aus jeder
Pace-Kennzahl ausgeschlossen; die bereinigte Kurve steht neben der rohen.
**Abnahme:** jede Pace-Kennzahl nennt die Zahl der ein- und ausgeschlossenen Runden.

### F31 — Boxenfenster und Stint-Vergleich
**Zweck:** Undercut/Overcut bewerten.
**Verhalten:** Zeitverlust der In-Lap, Gewinn der Out-Lap, Vergleich zweier Stints über
Reifenalter statt Rundennummer.
**Abnahme:** In-/Out-Laps sind als solche erkannt und nicht Teil der Pace-Regression.

### F32 — Kraftstoffkorrektur (optional, als Annahme gekennzeichnet)
**Zweck:** Renndistanz-Effekt herausrechnen.
**Verhalten:** optionale lineare Korrektur der Rundenzeit über die Renndistanz mit
anpassbarem Sekunden-pro-Runde-Faktor.
**Abnahme:** korrigierte Werte sind überall sichtbar als Annahme markiert; ohne
Kraftstoffdaten wird **kein** Faktor geraten (Standard aus).

#### E — Fahrzeugverhalten (nur als Proxy)

### F33 — Traktions-Proxy
**Zweck:** Radschlupf-Hinweis ohne Raddrehzahlen.
**Verhalten:** Bereiche mit Gas > 95 % und ausbleibendem Geschwindigkeitszuwachs werden
markiert.
**Abnahme:** im UI als **Proxy** benannt, mit Verweis darauf, dass Raddrehzahlen fehlen.

### F34 — Bremsstabilität
**Zweck:** Blockieren/Vorderradverlust als Hinweis.
**Verhalten:** Geschwindigkeitsabnahme pro Meter während der Bremsphase, Streuung je Kurve.
**Abnahme:** nur über die Bremsphase berechnet, nicht über die ganze Kurve.

### F35 — Höheneinfluss
**Zweck:** bergauf/bergab von Fahrweise trennen.
**Verhalten:** Geschwindigkeit bei gleicher Distanz gegen die Höhe (`z`) aufgetragen.
**Abnahme:** Höhenwerte sind als Dezimeter→Meter korrekt umgerechnet.

#### F — Session-weit

### F36 — Feld-Envelope je Kurve
**Zweck:** „wo ist das Feld schnell, wo nicht".
**Verhalten:** je Kurve beste und schlechteste Scheitelgeschwindigkeit aller Fahrer, mit
Namen; die eigene Position darin.
**Abnahme:** nur Fahrer mit Telemetrie; n der Fahrer steht dabei.

### F37 — Fahrer-Ranking je Kurve
**Zweck:** Stärken und Schwächen pro Fahrer und Kurve.
**Verhalten:** Δt je Fahrer gegen die gewählte Referenz (Abschnitt 6.3), sortierbar nach
Kurve, mit n und Vertrauensgrad je Zelle.
**Abnahme:** die Referenz ist in jeder Ansicht benannt; ein Wechsel der Referenz
aktualisiert alle Δ-Zellen gleichzeitig; eine Zahl ohne Referenz wird nicht gerendert.

### F38 — Session-Qualitätsbericht
**Zweck:** bevor man auswertet, wissen worauf.
**Verhalten:** Abdeckung (Fahrer, Runden, Samples), Lücken und Spitzen je Kanal,
unverifizierte Kurven, auffällige Runden, Laufzeit des Ingests.
**Abnahme:** der Bericht ist der erste Inhalt jeder Session-Seite, nicht versteckt.

### F39 — Mehrfach-Overlay
**Zweck:** mehr als zwei Fahrer vergleichen.
**Verhalten:** 3–5 Fahrer in denselben Lanes, Farbskala, Referenz umschaltbar, Linien
abschaltbar.
**Abnahme:** bei mehr als drei Linien wird automatisch auf dünnere Linien ohne Füllung
umgestellt.

#### G — Messwerkzeuge

### F40 — Bereichsmessung
**Zweck:** Kennzahlen für einen markierten Abschnitt statt für die ganze Runde.
**Verhalten:** Distanzbereich ziehen → Δt, Zeit, mittlere und maximale Geschwindigkeit,
Gas-/Bremsanteil, Anzahl Schaltvorgänge für genau diesen Bereich.
**Abnahme:** Werte sind auf den Bereich bezogen; das ist im UI ausgewiesen.

### F41 — Cursor-Snapping
**Zweck:** exakt auf Ereignisse springen statt daneben.
**Verhalten:** der Cursor rastet auf Scheitel, Bremspunkte, Schaltpunkte, Kurvenmarken,
Segmentgrenzen.
**Abnahme:** Umschalten zwischen freiem und rastendem Cursor; Rastpunkte sind sichtbar.

### F42 — Lesezeichen
**Zweck:** Befunde festhalten.
**Verhalten:** Distanzbereich mit Notiz markieren, Liste je Session, im URL-Zustand.
**Abnahme:** Lesezeichen überleben Neuladen und sind teilbar.

### F43 — Export
**Zweck:** weiterrechnen, dokumentieren, melden.
**Verhalten:** CSV der Kennzahlen (Kurven-, Segment-, Stint-, Schalttabelle), PNG der
Lanes, JSON-URL der Kennzahlen für externe Auswertung.
**Abnahme:** CSV enthält Einheiten im Kopf und `NaN` als leeres Feld; JSON ist versioniert.

---

### 6.3 Auswertungsarchitektur

#### Aggregationsebenen

```
Sample (7.3 Hz, unregelmäßig)
  └─ Distanzfenster (5 m Raster für Vergleiche)
      └─ Phase (Bremsen | Scheitel | Ausgang)
          └─ Segment / Kurve
              └─ Sektor
                  └─ Runde
                      └─ Stint
                          └─ Session
```

Jede Kennzahl gehört genau einer Ebene, und jede Anzeige nennt ihre Ebene. Ein
„Durchschnitt" ohne Ebene ist ein Fehler.

#### Metrik-Katalog (Auszug)

| Metrik | Ebene | Eingang | Methode | Vertrauen |
|---|---|---|---|---|
| Segmentzeit | Segment | `dist`, `t` | Zeitdifferenz an Segmentgrenzen | gemessen |
| `timeDeltaMs` | Kurve | Δ-Trace | Differenz zwischen dem Ende der vorigen und dem Ende dieser Kurve (Zuwachs, geklemmt am Mittelpunkt) | gemessen |
| Scheitelgeschwindigkeit | Phase | `speed` | Minimum im Kurvenabschnitt | gemessen |
| Bremspunkt | Phase | `brk`, `dist` | **Anfang** des zusammenhängenden Bremslaufs, der vor dem Scheitel endet; Rückblick 400 m, verworfen wenn das Bremsende mehr als 200 m vor dem Scheitel liegt. **Nicht** „letzte Bremsprobe im eigenen Fenster" — das stand hier falsch | gemessen |
| Gasannahme | Phase | `thr`, `dist` | Distanz Scheitel → 100 % Gas | gemessen |
| Schalt-RPM | Sample | `rpm`, `gear` | RPM beim Gangwechsel | gemessen |
| Δt-Beitrag Bremsung | Kurve | abgeleitet | Modell über Bremswegdifferenz | **Modell** |
| Δt-Beitrag Scheitel | Kurve | abgeleitet | Modell über v²-Differenz | **Modell** |
| Reifenabbau | Stint | Rundenzeiten | lineare Regression | gemessen, n-abhängig |
| Traktions-Proxy | Sample | `thr`, `speed` | Gas hoch, Zuwachs aus | **Proxy** |
| Querbeschleunigung | — | — | nicht verfügbar | **nicht verfügbar** |
| Bremsdruck | — | — | Kanal ist binär | **nicht verfügbar** |

#### Vertrauensgrade

| Grad | Bedeutung | Pflicht im UI |
|---|---|---|
| **gemessen** | direkt aus einem Kanal | nichts |
| **abgeleitet** | aus Kanälen berechnet, validiert | `*` und Methode im Tooltip |
| **Modell** | Annahme oder Zerlegung | Kennzeichnung + Annahme nennen |
| **Proxy** | Ersatz für eine fehlende Größe | als Proxy benannt, Grund genannt |
| **nicht verfügbar** | Daten fehlen | Feature wird nicht gebaut |

#### Statistik-Regeln

1. **Robuste Lage:** Median und MAD, nicht Mittelwert und σ. Ausreißer dürfen eine
   Kennzahl nicht verschieben.
2. **n immer mitliefern.** Keine Kennzahl ohne Stichprobengröße.
3. **Ausreißer markieren, nicht löschen.** `|x − Median| > 3 · MAD` wird markiert und
   bleibt sichtbar.
4. **Regression nur ab n ≥ 8**, mit R² und Steigung; darunter nur die Punkte.
5. **Keine Glättung ohne Angabe.** Wird geglättet, steht das Fenster dabei.
6. **Unschärfe der Abtastung respektieren.** Kennzahlen, die feiner als ~137 ms sind,
   werden nicht berichtet.

#### Referenz-Konzept

Alles Vergleichende braucht eine benannte Referenz. **Festgelegt:** die Referenz ist frei
wählbar, mit zwei Voreinstellungen, zwischen denen ein Knopf umschaltet.

| Referenz | Wofür | Rang |
|---|---|---|
| eigene beste Runde | Fahrfehler finden | **Voreinstellung A** |
| Stint-Median | Pace-Trend ohne Ausreißer | **Voreinstellung B** |
| Mittel der 3 besten Runden | robuster als eine einzelne Beste | wählbar |
| vorherige Runde desselben Fahrers | Runden-zu-Runden-Entwicklung | wählbar |
| Teamkollege | Fahrzeug- vs. Fahrereffekt | wählbar |
| Feldbestes je Kurve | Stärken/Schwächen im Feld | wählbar |
| Session-Bestzeit | absolute Referenz im Feld | wählbar |
| theoretische Beste | Potenzial im eigenen Datensatz | wählbar |
| gleiche Session-Klasse, frühere Saison | Entwicklung über Jahre | wählbar |

Die Referenz steht **immer** im UI, in jeder Ansicht und in jedem Export. Ein Δ ohne
Referenz wird nicht angezeigt. Wechselt die Referenz, ändern sich alle Δ-Kennzahlen
gemeinsam — es gibt keinen Zustand, in dem zwei Ansichten verschiedene Referenzen nutzen.

---

## 7. Einstellungen (Analyse-Parameter)

### 7.1 Prinzip

Ein zentrales Menü, erreichbar aus jeder Workbench-Ansicht (`s` oder Zahnrad). Es zeigt
**nur Parameter mit echtem Einfluss** — nicht jede Konstante im Code.

Faustregel für die Aufnahme: Zwei vernünftige Menschen würden unterschiedliche Werte
wählen, **und** das Ergebnis ändert sich dadurch sichtbar. Alles andere bleibt im Code.

Drei Regeln:

1. **Parameter ändern Methoden, nie die Ehrlichkeit.** Das Glättungsfenster ist
einstellbar, die Lücken-Spalte nicht abschaltbar. Es gibt keinen Schalter, der
Datenqualität verdeckt.
2. **Jede Abweichung vom Standard ist sichtbar.** In der Kopfleiste und in jedem Export.
3. **Jede Kennzahl kennt ihre Einstellungen.** Serverseitige Kennzahlen tragen einen
Settings-Fingerprint (7.4).

### 7.2 Katalog

#### Referenz und Vergleich

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Referenz-Standard | 9 Optionen (eigene beste Runde) | womit alles verglichen wird | **hoch** | Client | F7, F8, F13, F16, F37 |
| N für „Mittel der N besten" | 1–10 (3) | nur bei dieser Referenz | mittel | Client | F37 |
| Vergleichsmodus | 2 / Mehrfach 3–5 (2) | Anzahl Linien in der Lane | mittel | Client | F39 |

#### Rundenauswahl — was als gültig zählt

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Verkehrsfilter | an/aus (**an**) | schließt Runden im Verkehr aus | **hoch** | Server | F19, F21, F29, F30 |
| Verkehrsschwelle | 50–1000 m (300) | ab welchem Abstand gilt „im Verkehr" | **hoch** | Server | F29, F30 |
| In-/Out-Laps ausschließen | an/aus (**an**) | hält Boxenrunden aus der Pace | **hoch** | Server | F29, F31 |
| Ungenaue Runden ausschließen | an/aus (**an**) | nutzt `isAccurate` | mittel | Server | F19, F21 |
| Gelb-/SC-Runden ausschließen | an/aus (**an**) | nutzt `trackStatus` | **hoch** | Server | F29 |
| Mindest-n für Regression | 4–20 (8) | ab wann eine Gerade gezeigt wird | mittel | Server | F29 |

#### Kurven und Segmente

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Segmentmodus | kurvenbasiert / 100 m (**kurvenbasiert**) | Zerlegung der Runde | **hoch** | Server | F13, F17, F18 |
| Rasterweite | 25/50/100/200 m (100) | nur im Rastermodus | mittel | Server | F13, F18 |
| Scheitel-Suchfenster | 20–200 m (80) | wie weit um den Marker das Minimum gesucht wird | **hoch** | Server | F8, F14, F19, F23 |
| Kurven-Merge-Abstand | 0–100 m (20) | ab wann zwei Marker eine Kurve sind | mittel | Server | F8, F14 |
| Bremszonen-Fenster | 50–400 m (200) | maximale Distanz Bremsende → Scheitel | **hoch** | Server | F8, F20, F24 |
| Unverifizierte Kurven | markieren / ausblenden (**markieren**) | Umgang mit nicht bestätigten Kurven | mittel | Client | F8, F38 |

#### Ableitungen

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Glättungsfenster | 0/10/20/50 m (**0 = roh**) | glättet abgeleitete Kanäle | **hoch** | Client | F1, F33, F34 |
| Max. Zeitschritt | 100–1000 ms (250) | Samples mit größerem Δt fließen nicht in Ableitungen | **hoch** | Client | `accel`, F33, F34 |
| Ausreißer-Faktor | 2–6 MAD (3) | ab wann etwas als Ausreißer gilt | mittel | Client + Server | F19, F22, F38 |
| Beschleunigungsquelle | Speed-Kanal / Pfad (**Speed-Kanal**) | Pfad nur mit Warnhinweis | **hoch** | Client | `accel` |

#### Statistik

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Lagemaß | Median / Mittelwert (**Median**) | die zentrale Kennzahl | **hoch** | Server | F19, F21, F29 |
| Streuungsmaß | MAD / σ (**MAD**) | die Streuung | **hoch** | Server | F19, F21 |

#### Pace und Reifen

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Kraftstoffkorrektur | aus/an + s pro Runde (**aus**) | rechnet den Renndistanz-Effekt heraus | mittel | Server | F29, F32 |
| Reifenalter-Quelle | `tyreLife` / eigene Zählung (**`tyreLife`**) | x-Achse der Stint-Kurve | mittel | Server | F29, F31 |

#### Anzeige

| Parameter | Werte (Standard) | Wirkung | Impact | Gültigkeit | Features |
|---|---|---|---|---|---|
| Lane-Preset | Kern (6) / alles (12) / eigenes (**Kern**) | welche Lanes erscheinen | mittel | Client | F1, F4 |
| Lane-Höhe | kompakt / normal / groß (**normal**) | Dichte des Stapels | niedrig | Client | F1 |
| Diskretes Rendering | Stufen / Linien (**Stufen**) | brake/gear/drs/coast/trail | niedrig | Client | F1 |
| Cursor-Snapping | an/aus (**aus**) | rastet auf Ereignisse | niedrig | Client | F41 |
| Gitter | an/aus (**an**) | Lesbarkeit | niedrig | Client | F1 |

### 7.3 Voreinstellungen (Bündel)

| Name | Setzt | Wofür |
|---|---|---|
| **Qualifying** | Referenz = eigene Beste, Verkehrsfilter aus, nur Q-Session | eine schnelle Runde verstehen |
| **Rennen** | Referenz = Stint-Median, Verkehrsfilter an (300 m), In/Out aus | Pace über Stints |
| **Reifenanalyse** | Referenz = Stint-Median, Kraftstoffkorrektur an, Regression n ≥ 8 | Abbau verstehen |
| **Entwicklung** | Referenz = gleiche Session frühere Saison, Segmentmodus 100 m | über Jahre vergleichen |

Voreinstellungen sind **nur Bündel** von Einstellungen — keine eigenen Rechenwege. Wer ein
Bündel lädt, sieht danach genau, welche Werte gesetzt wurden.

### 7.4 Gültigkeit, Persistenz, Fingerprint

- **Geltungsbereich:** Basis aus dem Nutzerprofil (lokal gespeichert), pro Ansicht im URL
  überschreibbar.
- **Teilen:** die URL trägt nur die **Abweichungen** vom Standard. Ein geteilter Link
  reproduziert dieselben Zahlen, auch wenn sich Standardwerte später ändern.
- **Fingerprint:** jede serverseitige Kennzahl speichert `settingsHash` (über alle
  Server-Parameter) und `metricVersion`. Zwei Läufe mit unterschiedlichem Hash sind zwei
  getrennte Kennzahl-Sätze — sie werden nie stillschweigend gemischt.
- **Neuberechnung:** ändert sich ein Server-Parameter, markiert Convex betroffene Sessions
  als `stale` und bietet „neu berechnen (n Sessions)" an. Es wird **nicht** automatisch der
  ganze Bestand neu gerechnet.
- **Sichtbarkeit:** die Kopfleiste zeigt „Einstellungen geändert · n"; ein Klick öffnet das
  Menü genau bei den Abweichungen.

### 7.5 Was nicht ins Menü kommt

| Nicht einstellbar | Grund |
|---|---|
| Abtastrate, Quantisierung, Interpolation | Eigenschaften des Feeds, keine Wahl |
| Inhalt der Kurvendatenbank | kuratiert; nur über Backfill änderbar |
| Vertrauensgrad- und Ehrlichkeitsregeln | Policy, kein Parameter |
| Formeln und Methoden selbst | einstellbar sind Parameter, nicht die Methode |
| Alles, was Datenqualität verdeckt | Spitzen glätten „bis sie weg sind", Lücken als 0 behandeln, unverifizierte Kurven als Messung ausgeben — gibt es nicht |

---

## 8. Datenvertrag

### 8.1 Kanäle

| Kanal | Herkunft | Einheit | Verfügbarkeit |
|---|---|---|---|
| `t` | Feed | ms | immer |
| `dist` | Feed | m | immer |
| `speed` | Feed | km/h | immer |
| `rpm` | Feed | rpm | immer |
| `gear` | Feed | Gang | immer |
| `thr` | Feed | % | immer |
| `brk` | Feed | % | immer |
| `drs` | Feed | 0–14 | immer |
| `x`, `y` | Feed | Dezimeter | immer |
| `z` | Feed | Dezimeter | immer |
| `ahead` | Feed | m | neuere Payloads, NaN wenn führend |
| `rel` | Feed | 0–1 | neuere Payloads |
| `accel` | berechnet, **Zentraldifferenz** über ±1 Sample | m/s² | immer |
| `coast`, `trail` | berechnet aus Pedalen | % | immer |

### 8.2 Was es nicht gibt und nicht geben wird

- **Lenkwinkel** — nicht im Feed. Und die Position kann ihn nicht ersetzen: die erste
  Ableitung des Pfads hat Ausreißer bis zum Doppelten der realen Geschwindigkeit
  (p99 455 km/h gegen Kanal-Maximum 331 km/h).
- **Querbeschleunigung** — braucht die zweite Ableitung der Position; die weicht von der
  unabhängigen Speed um 23 g RMS ab, rohe Spitzen 8.8 g gegen real ~4 g. Messung:
  `analysis/lateral_accel.py`.
- **Yaw-Rate** — dieselbe Methode, Spitze 154 g. Serie wurde entfernt, nicht versteckt.
- **Bremsdruck** — `brk` ist binär (0 oder 100). Es gibt keinen Druckkanal. Möglich sind
  nur Dauer, Weg und Anteil — jede Druck- oder Modulationsanalyse ist unmöglich.
- **Raddrehzahlen** — fehlen. Traktion ist deshalb nur ein Proxy über Gas gegen
  Geschwindigkeitszuwachs, keine Messung von Schlupf.
- **Kraftstoffmenge, Reifendruck, Reifentemperatur, Aerodaten, Lenkmoment** — fehlen.
  Massenkorrektur bleibt eine Annahme, Reifenzustand ist nur über Alter und Compound
  beschreibbar.
- **Gangwechsel-Zeitpunkte** — nur als Sample, an dem sich `gear` ändert; Schaltdauer ist
  nicht messbar.

### 8.3 Grenzen der Daten, die im UI stehen müssen

- Abtastung ~7.3 Hz nominal, **unregelmäßig**: median 137 ms, max 1000 ms, beobachtetes
  Minimum **2 ms** — der gemergte Car+Pos-Zeitstempel, an dem sich die interpolierte
  Position kaum bewegt hat.
- **Ableitungen müssen zentraldifferenziell rechnen.** Über einen 2-ms-Schritt ergäbe eine
  Vorwärtsdifferenz aus 1 km/h Quantisierung bis zu 140 m/s². Der Kanal `accel` summiert
  deshalb zwei Schritte und reproduziert die Statistik exakt (−53,28 m/s² auf Abu Dhabi Q
  Runde 17). Siehe B2.
- Position 0.1 m quantisiert; **gemessen 51 % der Samples liegen exakt auf dem Raster, also
  49 % interpoliert** (Abu Dhabi Q, Fahrer 1; `analysis/lateral_accel.py`). Kleinster
  beobachteter Schritt 7 mm.
- Alles, was schärfer als die Abtastung ist, ist nicht ablesbar — deshalb steht `Δs` und
  `max Δs` im Readout.
- **Das Telemetrie-Fenster ist kürzer als die offizielle Rundenzeit** — gemessen 87 ms
  (Abu Dhabi) bis 307 ms (Silverstone), also 1–2 Samples, je Strecke und Session
  verschieden. Eine Runde lässt sich daher **nicht** aus der Telemetrie rekonstruieren. Der
  Unterschied steht als „window" im UI und darf nie als Fahrzeit gelesen werden.
- **Ableitungs-Extreme sind schema-abhängig**: dieselbe Runde ergibt −59,0 m/s² bei
  Vorwärtsdifferenz auf rohen Samples und −53,3 m/s² im Kanal `accel`. Extreme aus
  Ableitungen sind nur mit Angabe der Methode vergleichbar. Siehe Befund B2.

---

## 9. Auslieferung — eine Phase

Alles zusammen, kein Phasenschnitt, keine Teilauslieferung. Gegliedert in Arbeitsströme
mit Abhängigkeiten; die Reihenfolge innerhalb der Phase folgt den Abhängigkeiten.

### Arbeitsströme

| # | Arbeitsstrom | Features | Hängt ab von |
|---|---|---|---|
| A | Lane-Stack, Interaktion, Messwerkzeuge, Einstellungen | F1–F5, F40–F44 | — |
| B | Kurvenmodell, Annotation, Validierung | F6, F14, F17 | Kurven-DB + Erkennung |
| C | Segment- und Δt-Zerlegung | F13, F15, F16, F18 | B |
| D | Statistik und Konsistenz | F19–F22 | B |
| E | Fahrereingaben | F23–F28 | — |
| F | Pace, Stint, Verkehr, Reifen | F29–F32, F10, F30 | E |
| G | Fahrzeugverhalten (Proxies) | F33–F35 | E |
| H | Session-weite Auswertung | F36–F38, F39 | C, D |
| I | Analyse-Backend in Convex (serverseitig) | Kennzahl-Tabellen, Aggregation, F43-JSON | C, D, H |
| J | Datenqualität im UI | F5, F38 | A |
| K | Betrieb und Sicherheit | Auth, Watcher-Dienst, Backfill, README | — |

**Stand:** A im Kern umgesetzt und verifiziert — Lane-Stapel mit einer Lane pro Kanal
(12 auf allen vier geprüften Strecken), volle Breite, Cursor-Readout mit Schrittsteuerung,
Kanal-Statistik, Lane-Schalter. B: gemeinsame Rumpf-Zerlegung (`src/lib/segments.ts`) mit
Segmenten, Kurvenmarken in allen Lanes und Segmenttabelle. C: **F13**, **F15**, **F16**,
**F18** umgesetzt; B17 ist erledigt. **D: F19, F20, F21 und F22 (Abnahme) umgesetzt.**
Offen: der Streu-Scatter aus F22, die Einzelpunkte über der Distanz aus F20 und die
Segment-Quartile aus F21. **E bis K offen** — als nächstes F23 bis F28.

Befunde in Abschnitt 11: erledigt sind B1–B3, B5–B7, B10–B13; **B15 ist in der Ursache
behoben** (das Kurven-Δt war der Rundenstand, nicht der Kurvenverlust — ein Defekt in F8);
offen sind B4 (bewusst), B8 (zurückgestellt auf K) und B14 (Konsequenz für I).

**Befund aus der B-Validierung (vier Strecken):** Die Abnahme „Σ Segmentzeiten = Rundenzeit"
war falsch formuliert. Das Telemetrie-Fenster ist um 87–307 ms kürzer als die offizielle
Rundenzeit (1–2 Samples, je Strecke verschieden). Richtig ist: **Σ Segmente = Telemetrie-Span,
und das muss exakt null sein.** Geprüft auf Abu Dhabi, Suzuka, Silverstone und Melbourne —
Δ = 0 ms überall. Die Fensterdifferenz wird getrennt als „window" ausgewiesen.

### Reihenfolge

1. **K + A** zuerst: Sicherheit und die Ansicht, in der alles andere erscheint.
2. **B**, weil jede Auswertung eine Kurven- und Segmentdefinition braucht.
3. **C, D, E** parallel auf B aufsetzend.
4. **F, G** auf E; **H** auf C und D.
5. **I** zuletzt — es aggregiert, was C, D und H berechnen.
6. **J** begleitet A bis zum Schluss.

### Analyse-Backend — Entscheidung: serverseitig

**Festgelegt:** Kennzahlen werden in Convex berechnet und gespeichert, nicht im Browser.
Das ist die Variante, die skaliert und die bessere Datenqualität liefert.

Warum:
- **Skalierung.** Feld-Envelope (F36), Fahrer-Ranking (F37) und Saison-Vergleiche brauchen
  Daten aller Fahrer und Sessions. Im Browser müsste dafür jede Telemetriedatei geladen
  werden: 20 Fahrer × ~480 KiB × 24 Events ≈ 230 MiB pro Saison, nur um eine Zahl zu
  bekommen. Serverseitig sind es wenige KiB pro Runde.
- **Eine Implementierung.** UI, CSV-Export und JSON-API lesen dieselben gespeicherten
  Kennzahlen. Zwei Rechenwege — Browser und Server — laufen unweigerlich auseinander.
- **Wiederholbarkeit.** Jede Kennzahl trägt `metricVersion` und `computedAt`. Wird eine
  Methode korrigiert, lässt sich neu rechnen und der Unterschied ist nachvollziehbar,
  statt dass alte und neue Zahlen unbemerkt gemischt werden.
- **Reaktivität.** Convex-Queries sind live: sobald der Watcher eine Session fertigstellt,
  füllt sich die Auswertung ohne Neuladen.

Was serverseitig entsteht:

| Tabelle | Granularität | Inhalt |
|---|---|---|
| `lapMetrics` | Runde | Zeit, gültig/verworfen + Grund, Sektor- und Segmentzeiten, Verkehrsflag, Stint, Reifenalter |
| `cornerMetrics` | Runde × Kurve | Scheitel, Bremspunkt, Gasannahme, Ausgang, Phasendauern, verifiziert |
| `segmentMetrics` | Runde × Segment | Dauer, Δ zur Referenz, Flags |
| `stintMetrics` | Stint | Pace-Slope, R², n, Verkehrsanteil |
| `sessionQuality` | Session | Abdeckung, Lücken, Spitzen, unverifizierte Kurven |

Im Browser bleibt nur, was den Cursor betrifft — Sample-Readout, Bereichsmessung, Zoom.
Das braucht Latenz null und muss nirgends gespeichert werden.

Auslöser: der Watcher setzt nach dem Telemetrie-Upload `metricsStatus = "due"`; eine
Convex-Mutation rechnet die Tabellen und schreibt `metricVersion` mit.

### Definition of Done

- Jede Kennzahl im UI nennt Ebene, n und Vertrauensgrad.
- Jede vergleichende Zahl nennt ihre Referenz.
- Jede serverseitige Kennzahl trägt `settingsHash` und `metricVersion`; ein Wechsel eines
  Server-Parameters erzeugt einen neuen Kennzahl-Satz, statt alte Werte zu überschreiben.
- Aktive Abweichungen vom Einstellungs-Standard sind in der Kopfleiste sichtbar und
  stehen in jedem Export.
- Kein Feature aus Abschnitt 6.2 fehlt; jedes erfüllt sein Abnahmekriterium.
- Der Session-Qualitätsbericht (F38) ist der erste Inhalt der Session-Seite.
- Export (CSV/PNG/JSON) liefert dieselben Zahlen wie das UI — aus derselben Quelle.
- `analysis/` enthält für jede neue Ableitung ein Prüfskript wie `lateral_accel.py`.
- Prod und Dev ingestieren mit demselben Code; der Watcher läuft als Dienst und meldet
  im UI, wenn er älteren Code ausführt als das Repo.
- README beschreibt den echten Betrieb (lokaler Watcher, keine GitHub Actions).

### Risiken einer Ein-Phasen-Lieferung

- **Umfang.** Neun Arbeitsströme gleichzeitig sind viel für ein Projekt dieser Größe. Der
  Nutzen ist ein konsistentes Datenmodell; der Preis ist ein langer Abschnitt ohne
  benutzbare Zwischenstufe.
- **Abhängigkeitskette.** B blockiert C, D und H. Wenn die Kurvenerkennung auf einer
  Strecke versagt, verschiebt sich die halbe Auslieferung.
- **Validierungslast.** Jede abgeleitete Kennzahl braucht ein Prüfskript gegen echte
  Daten. Das ist der größte Einzelposten und wird regelmäßig unterschätzt.
- **Kein frühes Feedback.** Fehler im Kurvenmodell fallen erst am Ende auf, wenn alle
  Auswertungen darauf aufbauen.
- **Gegenmittel:** Arbeitsstrom B zuerst vollständig validieren, auf mindestens drei
  Strecken mit unterschiedlichem Charakter (Straße, Hochgeschwindigkeit, Höhenprofil),
  bevor C, D und H beginnen.

---

## 10. Entscheidungen und Restfragen

### Festgelegt

| # | Frage | Entscheidung | Auswirkung |
|---|---|---|---|
| 1 | Segmentdefinition | kurvenbasiert als Standard, 100-m-Raster als Vergleichsansicht | F13, F17, F18 |
| 2 | Δt-Zerlegung | Rest als eigene Zeile „nicht zugeordnet", nie erzwungen | F15, F16 |
| 3 | Referenz | frei wählbar, zwei Voreinstellungen (eigene Beste, Stint-Median) | F37, alle Δ-Kennzahlen |
| 4 | Aggregation | serverseitig in Convex | Arbeitsstrom I, F36–F38, F43 |
| 5 | Einstellungen | zentrales Menü, nur Parameter mit Impact, Fingerprint je Kennzahl | alle Features, F44 |

### Restfragen (blockieren die Umsetzung nicht)

5. **Lane-Höhen** — 12 Lanes à ~50 px am Stück, oder zwei Presets („Kern" 6, „alles" 12)?
   Vorschlag: Presets, „Kern" als Standard.
6. **Diskrete Kanäle** — Stufen rendern oder Zustandsbalken (Gear als Blockdiagramm)?
   Vorschlag: Stufen; Zustandsbalken später als Alternative.
7. **Kurvenmarken** — Linien in allen Lanes oder nur in der Speed-Lane? Vorschlag: alle
   Lanes, dünn und dezent, damit die vertikale Zuordnung sichtbar bleibt.
8. **Mobile** — Desktop-first; Vorschlag: kein eigenes Layout, nur ein Hinweis.
9. **Anomalie-Overlay (F11)** — bleibt blockiert, bis der Verkehrsfilter steht. Es gehört
   in diese Phase, aber ans Ende: ein Score im UI liest sich als Autorität.

---

## 11. Befunde

Alles, was in diesem Projekt gemessen wurde — auch die Fälle, in denen eine frühere Annahme
falsch war. Jeder Befund nennt Messung, Konsequenz und Status.

### B1 — Die Beschleunigungsspitze war echte Bremsung, kein Datenfehler
**Frühere Annahme (falsch):** −53 m/s² bei 2544 m sei ein Glitch im Speed-Kanal.
**Messung:** Abu Dhabi Q Runde 17, rohe Samples: 2502 m → 331 km/h, Bremse 0, Gas 100 %.
Ab 2516 m Bremse 100, Gas fällt auf 0, Speed 331 → 164 km/h bis 2582 m. Minimum
**−59,0 m/s² (−6,02 g)** bei 2532 m.
**Konsequenz:** F1 bremst mit 5–6 g — das ist eine Vollbremsung. F5 wurde korrigiert; als
Datenqualitäts-Beispiel dient jetzt der verifizierte Bremskanal-Artefakt.
**Status: erledigt** (Plan korrigiert).

### B2 — Korrigiert: der Kanal rechnet bereits robust
**Erste Annahme (falsch):** Der `accel`-Kanal leide unter kleinen Δt, der Parameter „Max.
Zeitschritt" ziele auf das falsche Ende, eine Mindest-Δt-Sperre sei nötig.
**Messung:** Der Kanal nutzt eine **Zentraldifferenz** über ±1 Sample und reproduziert auf
derselben Runde die Statistik **exakt**: −53,28 m/s² (−5,43 g). Meine −59,03 m/s² kamen aus
einer **Vorwärtsdifferenz** in meinem Ad-hoc-Skript. Der kleinste Zeitschritt im Fenster ist
**2 ms** (Median 137 ms); eine Vorwärtsdifferenz darüber ergäbe aus 1 km/h Quantisierung bis
zu 140 m/s², die Zentraldifferenz überbrückt ihn, weil sie zwei Schritte summiert.
**Konsequenz:** Kein Fix nötig, der bestehende Parameter bleibt sinnvoll (er schützt gegen
große Lücken). Der Befund belegt die Regel „erst messen, dann bauen" — sonst wäre eine
Sperre gegen ein Problem entstanden, das der Code schon löst.
**Status: erledigt** (geprüft, kein Fix).

### B3 — Das Telemetrie-Fenster ist kürzer als die offizielle Rundenzeit
**Messung:** Σ Segmente gegen offizielle Rundenzeit: −87 ms (Abu Dhabi), −156 (Melbourne),
−242 (Suzuka), −307 (Silverstone). Gegen den Telemetrie-Span: **Δ = 0 ms** auf allen vier.
**Konsequenz:** Die Abnahme „Σ Segmentzeiten = Rundenzeit" war falsch formuliert. Richtig
ist der Vergleich gegen den Span. Nicht behebbar, wird als „window" ausgewiesen.
**Status: erledigt.**

### B4 — Drei Kurven pro Strecke sind Marke, aber keine Messung
**Messung:** messbar sind 13/16 (Abu Dhabi), 15/18 (Suzuka), 15/18 (Silverstone), 14/14
(Melbourne). Ursache: die Edge-Minimum-Regel verwirft Kurven, deren Scheitel am Rand eines
fallenden Profils liegt.
**Konsequenz:** Marken werden für alle Kurven gezeichnet, die Tabelle bleibt streng, die
Differenz steht im Footer. **Status: offen** — bewusst sichtbar, die Alternative wäre,
fremde Scheitel zu berichten.

### B5 — Kurvenmarken stimmen mit den Datenbanken überein
**Messung:** 16 / 18 / 18 / 14 Marken im Browser gegen die Kurvenzahl der Events geprüft.
**Status: erledigt.**

### B6 — Sessions vor der Kanal-Erweiterung hatten nur 10 Lanes
**Messung:** Abu Dhabi 12 Lanes, Suzuka/Silverstone/Melbourne 10. Diese Payloads wurden vor
`ahead`/`rel` ingestiert.
**Behebung:** Re-Ingest der drei Sessions. Geprüft: **12 Lanes auf allen vier**, `Gap ahead`
und `Lap progress` vorhanden, Kachelung weiter Δ = 0 ms.
**Status: erledigt.**

### B7 — Ein laufender Watcher führt veralteten Code aus
**Messung:** `cmd_watch` liest seine eigenen Quelldateien nie; der Heartbeat trägt nur die
Deployment-URL. Zweimal beobachtet: Prod ingestierte ohne `ahead`/`rel`, weil der Prozess
vor der Änderung gestartet war. Nach dem Neustart waren alle 13 Kanäle da.
**Konsequenz:** Python hält Module im Speicher; Code-Änderungen erreichen einen laufenden
Prozess nicht. Der Watcher muss seine eigene Version melden und die UI muss warnen.
**Behebung:** Der Watcher hasht seine eigenen Quelldateien beim Start, prüft sie bei jedem
Poll erneut und meldet `codeVersion` + `codeStale` im Heartbeat; die UI zeigt eine Warnung.
Geprüft: frischer Start `stale=false`, nach einer Quelländerung `stale=true`, nach dem
Zurücksetzen wieder `false` — bei konstanter Version `60cba5550cc4`.
**Status: erledigt.**

### B8 — `requestIngest` ist öffentlich und ungeschützt
**Messung:** aus einem Skript ohne Authentifizierung erfolgreich aufgerufen. Einzige
Schranke: `MAX_PENDING_REQUESTS = 5`.
**Konsequenz:** Jeder mit der Prod-URL kann Ingestions auslösen. **Status: zurückgestellt**
— echte Auth ist Arbeitsstrom K, kein Fix am Rand.

### B9 — Prod hatte keine Daten
**Messung:** Prod 2018–2025: 24/24/22/… Events, jeweils **0** vollständige Sessions; die
deployte Seite zeigte nur Empty-States. Nach dem Smoke-Test: 1 Session (Abu Dhabi Q),
20 Dateien, 13 Kanäle.
**Konsequenz:** Betriebsstand, kein Fehler. **Status: teilweise erledigt.**

### B10 — uPlot 1.6 hat kein `setScale` in `Sync`
**Messung:** `Sync` bietet nur `key`, `setSeries`, `scales`, `match`, `filters`, `values`.
**Konsequenz:** Achsen-Synchronisierung läuft über `scales: ["x", null]`.
**Status: erledigt** — dokumentiert, damit es niemand erneut versucht.

### B11 — Zwei Zahlen für denselben Messwert
**Messung:** dieser Plan nannte ~49 % interpolierte Positions-Samples;
`analysis/lateral_accel.py` gibt ~40 % als Erwartung aus. Nachgemessen: **51 % der Samples
liegen exakt auf dem 0,1-m-Raster, also 49 % interpoliert** (kleinster Schritt 7 mm).
**Konsequenz:** Die Plan-Zahl war richtig, die Erwartung im Skript nicht; der Hinweistext
wurde auf den Messwert gesetzt. **Status: erledigt.**

### B13 — Das Prüfskript ist nicht eigenständig lauffähig
**Messung:** `python analysis/lateral_accel.py` bricht mit `ModuleNotFoundError: No module
named 'ingest'` ab, weil das Skriptverzeichnis statt der Repo-Wurzel im Suchpfad landet.
**Konsequenz:** Die Definition of Done verlangt für jede Ableitung ein Prüfskript; eines,
das man nicht aufrufen kann, erfüllt das nicht.
**Behebung:** `sys.path`-Bootstrap im Skript, damit es aus jedem Verzeichnis läuft.
**Status: erledigt.**

### B14 — Re-Ingest verschiebt abgeleitete Kennzahlen minimal
**Messung:** Nach dem Re-Ingest derselben Sessions änderte sich die Zahl der messbaren
Kurven bei zwei von vier Strecken um eins (Suzuka 15 → 14, Silverstone 15 → 14; Abu Dhabi
und Melbourne unverändert). Die Segmentzahl änderte sich entsprechend (26 → 24, 27 → 26).
Die Kurvenmarken blieben gleich (18 / 18), die Kachelung exakt.
**Konsequenz:** Zweimal ingestierte Daten sind nicht bitgleich — FastF1s Merge legt die Samples
anders, und eine Kurve kippt dann über die Edge-Minimum-Regel. Für den Plan heißt das:
`metricVersion` allein genügt nicht, der **Telemetrie-Stand muss mitgezählt werden**, sonst
sind zwei Kennzahl-Sätze nicht vergleichbar.

**Untersuchte und verworfene Behebung:** Die Edge-Minimum-Regel prüft, ob das Minimum das
*letzte* Sample des Fensters ist (`apex === apexTo - 1`), und eine Form-Regel („ist der Speed
nach dem Minimum um ≥ 3 km/h gestiegen?") sollte das stabilisieren. Gemessen auf Abu Dhabi
und Suzuka, Fenster um ±1 Sample verschoben: **beide Regeln sind stabil** (alt 67/74 bzw.
66/83 konstant, neu 64/74 bzw. 58/83 konstant). Die Positionsregel kippt also nicht durch
eine Verschiebung — und die Form-Regel misst **weniger** Kurven, würde B4 also verschlechtern.
Der Re-Ingest ändert die Daten selbst, nicht das Fenster; deshalb ist B14 durch keine
Regeländerung behebbar. **Die Änderung wurde verworfen, nicht eingebaut.**
**Status: offen** — Konsequenz für Arbeitsstrom I (Telemetrie-Stand in den Fingerprint).

### B12 — Dokumentation widersprach dem Betrieb
**Messung:** 17 falsche oder irreführende Aussagen in `README.md` und `ingest/README.md`:
der Worker als „GitHub Actions" statt lokaler Watcher, „neue Daten landen kurz nach jeder
Session" obwohl nichts automatisch lädt, `run-due` statt `watch` als empfohlener Befehl,
`by-session` als „used by CI", R2 als tatsächliches Objekt-Storage nirgends erwähnt, die
Kanal-Liste ohne `ahead`/`rel`, und die Behauptung „nichts versucht den blockierten Pfad",
während `ingest-cron.yml` alle 30 Minuten genau das tut.
**Behebung:** Beide READMEs korrigiert — On-Demand-Ablauf, ein Abschnitt „Running the
workers" mit beiden Watchern, vollständige Befehlsliste, R2 und seine Variablen, die
Kanal-Liste, und der Hinweis, dass die Workflows nicht ingestieren können.
**Status: erledigt.**

### B15 — Das Kurven-Δt war der Rundenstand, nicht der Kurvenverlust
**Erste Annahme (falsch):** Die Zerlegung sei zu eng, weil ihre Fenster nur Bremsbeginn →
Ausgang abdecken; deshalb liege 55–85 % des Verlusts in „nicht zugeordnet".
**Messung (die eigentliche Ursache):** `cornerDeltas` las den Δ-Trace **am Scheitel**
(`sampleAt(trace.dist, trace.delta, left.apexDist)`). Das ist der **kumulierte**
Zeitunterschied seit Rundenstart — nicht das, was die Kurve gekostet hat. Jede Kurve nach
einem früheren Fehler sah dadurch schlecht aus, für einen Grund, der woanders passiert war,
und keine Phasen-Zerlegung konnte je dazu summieren: die Phasen decken ein Fenster, der Wert
die ganze Runde. Der Befund war also ein **Defekt in F8**, nicht nur im Modell.
**Behebung:** Das Kurven-Δt ist jetzt der Zuwachs **durch** die Kurve — von dort, wo die
vorige endete, bis zu ihrem Ende, geklemmt am **Mittelpunkt** zur nächsten Kurve. Die
Inkremente kacheln die Runde. Gemessen auf Abu Dhabi Q (VER gegen NOR), kumuliert → Zuwachs:

| Kurve | vorher | nachher |
|---|---|---|
| T6 | +0,628 s | **+0,072 s** |
| T12 | +0,548 s | **+0,260 s** |
| Summe der 15 Inkremente | — | 0,308 s gegen Trace-Total 0,283 s |

Die Rangliste rankt damit nach **Kosten** statt nach Rundenstand — was die Antwort ändert:
T7 war Dritter und ist jetzt nirgends, T8 und T13 sind die Verlustkurven.

**Drei Korrekturen, jede durch eine Messung erzwungen, nicht durch Hinsehen:**
1. Die Fenster kachelten die Kurve nicht → der Rest hielt 55–85 % des Verlusts.
2. Klemme am nächsten Bremsbeginn → T6s Fenster kollabierte auf **null**, weil Abu Dhabis
   T6 und T7 nur 63 m auseinanderliegen und T7 *vor* T6s Scheitel bremst. Ohne diese Messung
   wäre eine Kurve ohne Bremsphase ausgeliefert worden, in der der Fahrer mit 6 g bremst.
3. Klemme am Mittelpunkt → beide Kurven behalten die halbe Lücke.

**Was bleibt:** Der Rest ist jetzt der Unterschied zweier Methoden — der resampelte
Δ-Trace gegen das direkte 1/v-Integral — und steht als `residual` im UI, statt versteckt zu
werden. **Status: Ursache behoben**; die Restdifferenz bleibt sichtbar und erklärt. Eine
weitere Verbesserung wäre, beide Seiten auf dieselbe Methode zu bringen.

### B16 — Der Plan schiebt die Multi-Runden-Auswertung hinter ihre eigene Voraussetzung
**Messung:** Vier Features aus C und D brauchen die Segment- oder Kurvenwerte **aller**
Runden eines Fahrers: F18 (Segment-Matrix), F19 (Scheitel-Konsistenz), F21
(Rundenzeit-Streuung je Sektor) und F22 (Ausreißer-Scatter). Die Reihenfolge des Plans
stellt Arbeitsstrom I — die serverseitige Aggregation — dagegen **ans Ende**, nach C, D
und H.

**Korrektur meiner eigenen Schätzung (falsch):** Ich hatte die Kosten als „20 Runden ×
~480 KiB ≈ 9,6 MiB pro Fahrer" gerechnet und daraus abgeleitet, F18 sei clientseitig nicht
baubar. **Nachgemessen:** Ein Telemetriefile enthält die **ganze Session** eines Fahrers,
nicht eine Runde — 480 KiB, 26.819 Samples, alle Runden darin. F18 braucht also **einen**
Fetch, nicht zwanzig; die Runden werden clientseitig aus demselben Puffer geschnitten.
Der Zugriffspfad war behauptet, nicht geprüft.

**Konsequenz:** Die Zirkularität bleibt für die **feldweiten** Features (F36, F37,
Saison-Vergleiche: 20 Fahrer × 480 KiB pro Session), aber sie gilt **nicht** für die
fahrerbezogenen Features F18, F19, F21, F22 — die sind mit einem Fetch pro Fahrer gebaut.
I bleibt richtig, aber es blockiert C und D nicht mehr.
**Status: erledigt** — Entscheidung (b) umgesetzt, F18 ist gebaut und läuft.

### B17 — Die Matrix zeigt 2-Sekunden-Verluste auf sauberen Runden
**Messung:** Beim ersten Lauf der Matrix (Abu Dhabi Q, Fahrer 1) stehen auf Runden, die
weder Box noch Verkehr noch `isAccurate=false` tragen: **+2.082 ms** in einem Segment auf
der **schnellsten Runde der Session** (L17, 1:22.207) und **+2.499 ms** in einer weiteren
Zeile. Beide Werte liegen zwei Größenordnungen über den Nachbarsegmenten derselben Zeile.
**Zwei Erklärungen, noch nicht entschieden:**
- **(a) Echte Anomalie im Datenbestand** — z. B. eine Runde, in der `ahead` durchgehend NaN
  ist (führendes Auto), sodass der Verkehrsfilter nicht greift und eine SC-/Gelbphase als
  Fahrzeit in die Spalte eingeht.
- **(b) Fehler in der Matrix** — die Spalten werden über `label` zugeordnet. Wenn die
  Zerlegung zweier Runden einem Label unterschiedliche Distanzbereiche gibt, vergleicht die
  Zelle zwei verschiedene Kurvenabschnitte.
**Konsequenz:** Solange das offen ist, ist **jede** Zellaussage der Matrix vorläufig — die
Abnahme („gefilterte Runden sichtbar ausgegraut") ist erfüllt, die *inhaltliche* Richtigkeit
der großen Werte nicht belegt. Nicht als Datenqualitäts-Badge verwenden.
**Status: Ursache gefunden und behoben, Restwert offen.**

**Messung, die (a) von (b) getrennt hat:** Die `ahead`-Abdeckung ist **1,00 auf jeder
Runde**, auch auf L17 (minGap 1617 m). Hypothese (a) ist damit **widerlegt** — kein
führendes Auto mit durchgehend NaN, der Verkehrsfilter greift.

**Ursache (b), im Code nachgewiesen:** Geraden trugen einen **Zähler pro Runde**
(`S${straightIndex}` in `segments.ts`), keinen Bezug zur Strecke. Die Edge-Minimum-Regel
erkennt auf jeder Runde eine andere Kurvenmenge (B4: 3 Kurven pro Strecke fehlen), also
verschmilzt auf einer Runde ohne T7 zwei Geraden zu einer und **jede weitere `S`-Nummer
rutscht um eins**. Spalte `S3` verglich eine kurze Gerade mit einer, die eine ganze Kurve
samt Bremszone geschluckt hatte. Geraden heißen jetzt nach der Kurve, in die sie führen
(`→T8`) — dieselbe Strecke auf jeder Runde, unabhängig davon, ob T7 bestätigt wurde.
Kurvenlabels (`T*`) waren bereits identitätsstabil und blieben unverändert.

**Zweite Absicherung:** Auch mit stabilen Labels kann ein Segment auf einer Runde mehr
Strecke abdecken. Die Matrix vergleicht deshalb den `fromM` der Zelle mit dem des
Spaltenkopfs und schreibt **`±` statt einer Zahl**, wenn sie mehr als 200 m auseinander
liegen. Gemessen: **7 Zellen** sind so markiert.

**Die Messung, die den Restwert entscheidet — der Wert ist nicht real:** L17 gegen L5 (die
beiden sauberen Runden), Zeit pro 100 m verglichen. Die größte Differenz auf der **ganzen
Runde** ist **−303 ms** bei 2500–2600 m; kein Fenster kommt auch nur in die Nähe von 2 s.
Das langsamste 100-m-Fenster liegt auf **jeder** Runde bei 2600 m und dauert 3,8–4,1 s
(L17 3,998 / L5 3,953 / L14 3,817 / L11 4,117 s). Die Telemetrie ist glatt. **Die
+2.082/2.499/−1.782 ms existieren im Datenbestand nicht** — sie sind ein Artefakt der
Zerlegung.

**Ursache, im Code nachgewiesen (drei Wege, nicht einer):**
1. **Clip-Pfad** (`segments.ts`): `from = max(cursor, windowFrom)` kann **über den eigenen
   Scheitel der Kurve hinaus** rutschen. Das Segment trägt dann das Label `T12`, deckt aber
   nicht T12 ab — erkannt daran, dass `apexM < fromM` gilt.
2. **`continue`-Pfad**: wird eine Kurve wegen `to <= from` verworfen, liegt ihr ganzes
   Gebiet **hinter** dem Cursor und wird vom **vorherigen** Segment geschluckt; das
   absorbierende Segment behält `verified: true` und verrät nichts. (Meine Annahme, die
   *nächste* Kurve schlucke sie, war falsch — die Algebra lässt das nicht zu.)
3. **`cornerPerformance`-Drop**: eine gar nicht erst gelieferte Kurve hinterlässt keine
   Spur außer einer **Lücke in der Labelfolge** (`T6 → →T8`).

**Behebung:** Die Matrix prüft jetzt zusätzlich, ob der Scheitel eines Kurvensegments
**innerhalb** seines eigenen Bereichs liegt. Ist er es nicht, schreibt die Zelle `±` mit
Begründung statt einer Zahl. Die Bereichsdrift-Prüfung (±200 m) bleibt daneben bestehen.
**Status: erledigt.** Auch **Weg 2 ist behoben**: die Zerlegung führt jetzt `absorbed:
string[]` an jedem Segment — die Labels der Kurven, deren Gebiet dieses Segment geschluckt
hat. Die Matrix schreibt dafür `±` und nennt die verschluckte Kurve beim Namen. Der
absorbierende Nachbar ist damit nicht mehr unsichtbar: das Segment sagt selbst, dass es
mehr ist als die Kurve, nach der es heißt. Weg 3 (`cornerPerformance`-Drop) bleibt als
Lücke in der Labelfolge sichtbar und wird mit B4 geführt, weil er dieselbe Ursache hat.

### B18 — Die UI behauptete einen Filter, den der Code nicht anwendete
**Messung:** Ein Prüf-Agent hat das neue Konsistenz-Panel gegen die Statistik-Regeln
dieses Plans gelesen. Der Footer sagte „Laps that are inaccurate, in the pits or **in
traffic** are excluded", und der Code prüfte Verkehr **nie** — `ConsistencyLap` hatte kein
Verkehrsfeld, die Filterzeile kannte nur `isAccurate`, Box und Rundenzeit. Der Plan führt
F19 in §7.2 aber ausdrücklich als vom Verkehrsfilter betroffen (Standard **an**).

**Vier weitere Defekte aus derselben Prüfung:**
1. Die im UI gedruckte Ausreißerregel lautete `|x − Median| > 3 · MAD`, der Code verlangte
   zusätzlich `MAD > 0`. Bei MAD = 0 widersprachen sich gedruckte und ausgefürte Regel —
   genau in dem Fall, den der Leser auf dem Schirm sieht (MAD 0.0, keine Markierung).
2. Beide Spannweiten-Zellen sicherten nur den **unteren** Wert ab und hätten `123.4–NaN`
   drucken können.
3. Der „·"-Platzhalter der Scheitel-Ausreißer hing an `noBrakeLaps` — einer Größe der
   **Brems**spalte. Eine Kurve ohne Scheitel-Ausreißer, aber mit ungebremsten Runden, ließ
   die Zelle leer statt einen Punkt zu zeigen.
4. Nichts hinderte den Leser, MAD für eine Standardabweichung zu halten. Die sind nicht
   dasselbe (σ ≈ 1,48 · MAD), und das Panel sagt es jetzt.

**Konsequenz:** Alle fünf sind behoben — der Verkehrsfilter wird jetzt **gemessen**
(`ahead`, 300 m, wie in der Matrix) und die Zahl der ausgeschlossenen Runden steht im
Footer, statt dass der Filter behauptet wird. Der Klasse nach ist das derselbe Fehler wie
B12: eine Beschreibung, die dem Betrieb widerspricht. Diesmal stand der Widerspruch im
Produkt, nicht in der Dokumentation.
**Status: erledigt.**

### B19 — Sektorzeiten lagen seit dem ersten Ingest in der Datenbank, ungelesen
**Messung:** Die `laps`-Tabelle trägt `s1Ms`, `s2Ms`, `s3Ms` (`convex/schema.ts:112–114`),
gefüllt aus FastF1s `Sector1Time`/`Sector2Time`/`Sector3Time` (`ingest/normalize.py:402–404`)
und validiert (`convex/ingest.ts:56–58`). Eine Suche über das ganze Repo findet sie an
**genau drei Stellen**: Schema, Validator, Insert. **Keine Query, kein Feature, keine
Kennzahl hat sie je gelesen.** F21 stand seit dem ersten Entwurf im Plan und hätte ohne
einen einzigen Byte Telemetrie gebaut werden können.

**Zweiter Teil der Messung — was fehlt:** Sektor-**Grenzdistanzen** existieren nirgends.
Kein Feld in irgendeiner Tabelle hält sie; die kuratierten Kurvendistanzen
(`events.corners[].distance`) sind Kurvenpositionen, keine Sektor-Schnitte. Der Plan
definiert den Begriff „Sektor" nie — die Hierarchie `Segment / Kurve → Sektor → Runde`
legt eine kurvenbasierte Gruppierung nahe, sagt es aber nicht. Und der Datenvertrag (§8.1,
§8.2) erwähnt Sektoren **gar nicht**, weder als verfügbar noch als nicht verfügbar.

**Konsequenz:** Für F21 sind die Grenzen auch **nicht nötig** — Quartile einer *Dauer*
brauchen keine Position auf der Strecke. F21 ist damit vollständig baubar und gebaut.
Grenzen wären erst nötig, um einen Sektor **auf der Strecke** zu markieren, und das
verlangt kein Feature. Der Befund bleibt trotzdem wichtig: er zeigt, dass eine vorhandene
Datenbasis über Jahre ungenutzt sein kann, ohne dass es irgendwo auffällt — und dass der
Datenvertrag Dinge verschweigt, statt sie als fehlend zu führen.
**Status: erledigt** — F21 gebaut, Lücke im Datenvertrag notiert.

**Eigene Fehlmessung, zur Vollständigkeit:** Meine erste Prüfung dieses Punkts suchte per
Shell nur exakt `s1`/`s2`/`s3` und meldete „NONE". Die Felder heißen `s1Ms` usw. Ein
Subagent hat es korrekt gefunden. Wieder eine Behauptung, die eine Messung widerlegt hat —
diesmal meine eigene.

### B20 — Die teure Doppelarbeit existiert nicht, die billige ist nicht gemessen
**Anlass:** Drei Panels laden dieselbe Telemetriedatei (480 KiB) — `workbench-chart`,
`segment-matrix`, `consistency-panel`. Ich hielt das für dreifachen Netzwerk- und
Dekodieraufwand und wollte es beheben.

**Messung:** `loadTelemetry` hält bereits einen **Promise-Cache auf Modulebene** (8
Einträge, Insertion-Order-Verdrängung, Fehler werden entfernt). Der erste Aufruf legt das
Promise synchron ab, die beiden anderen treffen den Cache — auch gleichzeitige Aufrufe
kollabieren zu einem Fetch. Gemessen im Browser: **1 Netzwerk-Fetch und 1 gunzip+msgpack**
pro Seitenaufbau, nicht drei. Meine Sorge war unbegründet (siebte Fehlannahme in Folge, die
eine Messung widerlegt hat).

**Was der Agent stattdessen gefunden hat:** Auf der CPU-Ebene wird sehr wohl doppelt
gerechnet. `segment-matrix` und `consistency-panel` laufen **jeder** über alle Runden und
rufen `lapSeries` + `buildSegments` je Runde auf; die Lane-Leiste zerlegt zusätzlich die
gewählte Runde. Macht **2N + 1 Aufrufe** pro Seitenaufbau — bei ~18–21 Runden also rund
**40 Zerlegungen**, und jede Runde wird mindestens zweimal, die gewählte dreimal zerlegt.
Ein Cache auf (Runde, Kurven) existiert nicht.

**Warum ich das trotzdem nicht behebe:** Die **Kosten sind nicht gemessen.** Eine
Zerlegung ist ein Interpolationslauf über ~4.500 Samples plus Kurvenauswertung; 40 davon
können 5 ms oder 120 ms sein, und ich weiß es nicht. Genau diese Lücke war B2: eine Sperre
gegen ein Problem, das der Code schon löste. Der Unterschied zur Netzwerkseite ist: **dort
habe ich gemessen, hier nicht.** Ein Cache würde die Zahlen nicht verändern — beide Panels
rufen dieselbe Funktion mit denselben Eingaben auf, sie können nicht auseinanderlaufen.

**Konsequenz:** Wer das angehen will, misst zuerst die Zeit für 2N+1 Zerlegungen gegen eine
mit Profiler gemessene Gesamtzeit der Seite. Erst wenn die Zerlegung dort sichtbar ist, ist
ein Cache auf (Runde, Kurven) gerechtfertigt — nicht vorher.
**Status: gemessen und abgeschlossen** — die Netzwerkseite ist nachweislich dedupliziert,
die CPU-Seite ist als offen **mit fehlender Messung** dokumentiert, nicht als Fehler.

### B21 — Der Bremspunkt kann zur falschen Kurve gehören
**Messung:** Nach dem Einbau von F23 zeigt das Konsistenz-Panel auf Abu Dhabi Q, Fahrer 1:
**T1 und T2 haben identische Bremswerte** — Median 301,3 m, Spanne 294,2–308,5 m in beiden
Zeilen. Zwei verschiedene Kurven werden nicht auf den Meter gleich gebremst. T1s Median
ist plausibel (eigene Bremszone), T2s ist **T1s Wert**: T2s Fenster öffnet, während T1 noch
gebremst wird, und `brakeDist` ist definiert als „letzte Bremsprobe vor dem eigenen
Scheitel im eigenen Fenster" — die liegt dann in T1s Bremszone.
**Konsequenz:** F20 (Bremspunkt-Streuung) und die Spalte `brake med` können einer Kurve
den Bremspunkt einer anderen zuschreiben. Das ist derselbe Fehlertyp wie B17 — eine Zahl,
die plausibel aussieht und zur falschen Sache gehört. Die Datenlage macht es schlimmer:
mit n = 2 fällt es nur auf, weil die beiden Werte **exakt gleich** sind; bei n = 15 wäre es
ald normale Streuung untergegangen.
**Status: offen — Ursache bewiesen, ein Verbraucher von vier behoben.**

**Der Beweis (Algebra, vom Agenten geprüft):** `buildSegments` öffnet das Fenster einer Kurve
mit `from = max(cursor, brakeDist, startM)`. Da `max` jedes Argument dominiert, gilt
**`brakeFromM <= fromM` strukturell immer** — es gibt keinen Codepfad, auf dem der
Bremspunkt echt innerhalb seines eigenen Segments liegt. **Gleichheit ist der Normalfall**
(das Fenster öffnet genau am Bremspunkt); eine echte Ungleichung heißt, dass der Wert zu
einem früheren Segment gehört. Zwei Kurven können denselben `brakeDist` bekommen, wenn ihre
Scheitel im selben zusammenhängenden Bremslauf liegen — bei Abu Dhabi T1/T2 der Fall.

**Warum die Definition im Plan falsch war:** `brakeDist` ist nicht „die letzte Bremsprobe
vor dem Scheitel", sondern der **Anfang des Bremslaufs** (`corners.ts:186–206`, der Code
läuft rückwärts bis `brk <= 0`), und das Suchfenster ist ein **400-m-Rückblick**
(`BRAKE_LOOKBACK_M`), **nicht** das ±80-m-Fenster der Kurve. Der Rückblick ist auch nicht
am Mittelpunkt zur Nachbarkurve geklemmt — genau deshalb kann eine Kurve die Bremszone der
vorigen übernehmen. Die Katalog-Zeile in §6.3 wurde korrigiert.

**Behoben:** `consistency-panel` zählt einen Bremspunkt nur, wenn er in seinem eigenen
Segment liegt; sonst erscheint er als **⤺** mit Grund statt im Median. `workbench-chart`s
Spalte „brake from" schreibt **⤺ prev** statt einer Zahl. `cornerDeltas` liefert
`brakeDeltaM = null`, wenn einer der beiden Werte geerbt ist — **identische `brakeDist`
auf benachbarten Kurven ist das erkennbare Signal** —, sodass die Spalte „Brake" und der
Ranglisten-Text keinen Urteilssatz mehr aus einer fremden Bremszone bilden.

**Noch offen:** `corner-breakdown` nutzt `brakeDist` weiter als Grenze zwischen
`approachMs` und `brakeMs`. Bei einem geerbten Wert klemmt sie auf den Segmentanfang, und
der ganze Anlauf der späteren Kurve wird als „bremsen" beschriftet. Dieselbe
Erbprüfung gehört dort hin; sie steht hier, damit sie nicht vergessen wird.
**Nächster Schritt:** die `inheritedBrakeLabels`-Prüfung in `corner-breakdown`
übernehmen, wo der Wert über `cornerPerformance` direkt kommt.

### B22 — Der Verkehrsfilter lässt zwei von achtzehn Runden übrig
**Messung:** Das Konsistenz-Panel zählt auf Abu Dhabi Q, Fahrer 1 **2 Runden** von 18 — die
übrigen 16 fallen durch Box, Ungenauigkeit, Gelb/SC oder den Verkehrsfilter. Die Matrix
zählt 13 Runden, das Sektor-Panel 6: **drei Panels, drei verschiedene Grundgesamtheiten**,
weil jeder andere Filter anwendet.
**Konsequenz:** Bei n = 2 ist jeder Median und jede MAD-Kennzahl fragil — der Plan verlangt
robuste Kennzahlen, aber Robustheit braucht Stichprobe. Die 300 m aus §7.2 sind der
Standard für den Verkehrsfilter, und in einer Qualifying-Session mit 20 Autos auf der
Strecke sind 300 m sehr streng. Der Wert ist einstellbar (50–1000 m), aber es gibt noch
kein Einstellungsmenü (F44) — bis dahin ist der Standard nicht änderbar.
**Status: offen** — braucht eine Entscheidung, keinen Code: entweder den Standard für
Qualifying-Sessions lockern, oder im UI ausweisen, dass die Grundgesamtheit klein ist.
Die drei verschiedenen Grundgesamtheiten sollten sichtbar sein.

### Was davon jetzt behebbar ist

| Befund | Aktion |
|---|---|
| B1, B3, B5, B10 | erledigt — Plan korrigiert, Code-Kommentar berichtigt |
| B6 | erledigt — Re-Ingest, 12 Lanes auf allen vier Strecken geprüft |
| B7 | erledigt — Watcher meldet Code-Version, Stale-Erkennung end-to-end geprüft |
| B11 | erledigt — 51 % auf dem Raster gemessen, beide Stellen korrigiert |
| B13 | erledigt — Prüfskript läuft eigenständig |
| B2 | erledigt — geprüft: der Kanal rechnet bereits zentraldifferenziell, kein Fix nötig |
| B4 | bewusst offen — die Alternative wäre, fremde Scheitel zu berichten |
| B8 | zurückgestellt — echte Auth ist Arbeitsstrom K, kein Fix am Rand |
| B12 | erledigt — 17 falsche Aussagen in beiden READMEs korrigiert |
| B14 | offen — Regeländerung gemessen und **verworfen** (Regel ist stabil, Form-Regel misst weniger); Konsequenz für Arbeitsstrom I |
| B15 | **Ursache behoben** — kumuliert → Zuwachs, Klemme am Mittelpunkt; Rest = Methodendifferenz, sichtbar ausgewiesen |
| B22 | offen — der Verkehrsfilter lässt 2 von 18 Runden; drei Panels zählen drei verschiedene Grundgesamtheiten |
| B21 | **Ursache bewiesen, teilweise behoben** — `brakeFromM <= fromM` ist strukturell immer wahr (Gleichheit ist der Normalfall), zwei Kurven können denselben Bremslauf erben; Konsistenz-Panel und Lane-Tabelle geschützt, `compare-charts` und `corner-breakdown` noch nicht; die Plan-Definition war zusätzlich falsch |
| B20 | erledigt — der Fetch war bereits dedupliziert (1 statt 3), gemessen; die CPU-Doppelarbeit ist als **unmessiert** dokumentiert und wird bewusst nicht „optimiert“ |
| B19 | erledigt — Sektorzeiten waren da und ungelesen, F21 gebaut; der Datenvertrag nennt Sektoren nicht, das ist notiert |
| B18 | erledigt — fünf Defekte aus einer Agenten-Prüfung behoben; der schwerste war ein behaupteter Verkehrsfilter, der nie lief |
| B17 | **erledigt** — Ursache und Restwert gemessen: die 2-Sekunden-Werte existieren im Datenbestand nicht (max. 303 ms per 100 m), sie sind ein Zerlegungs-Artefakt; Clip-Pfad durch `±` erkannt, der absorbierende Nachbar bleibt als nicht erkennbar dokumentiert |
| B16 | erledigt — eigene Kostenschätzung war falsch (ein File = ganze Session); F18 mit einem Fetch gebaut |
