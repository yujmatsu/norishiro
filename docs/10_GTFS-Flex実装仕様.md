# GTFS-Flex実装仕様書（パーサ＋RAPTOR拡張 実装向け）

**状態: 完了（公式仕様の一次資料確認＋瑞穂町実データ照合済み）**
**作成日: 2026-07-02**
**対象読者: 本ドキュメントを実装する開発者（Claude Code）**

本書は、TypeScriptでGTFS-Flex対応の経路検索エンジン（パーサ＋RAPTOR拡張）を実装するにあたり、これ一冊を読めばパーサとルーティングのFlex対応を正しく実装できることを目指したドキュメントである。公式仕様（gtfs.org）の定義に忠実に記述し、取得できなかった情報は「要確認」と明記する。

なお、作業計画（`08_作業計画_WBS.md`）ではパーサ仕様（W2＝本書）とルーティングエンジン設計（W5＝`13_ルーティングエンジン設計.md`）を別ドキュメントとして区分しているが、本書はユーザーからの直接指示によりルーティング解釈（RAPTORへのFlex統合の設計指針）まで含めて記述する。`13_ルーティングエンジン設計.md`では、本書で示す設計指針を前提として、RAPTORアルゴリズム全体の詳細実装（優先度付け、多基準最適化、実データでのベンチマーク等）を扱う想定とする。

---

## 目次

1. [Flexの全体像](#1-flexの全体像)
2. [ファイル・列リファレンス（実装対象サブセット）](#2-ファイル列リファレンス実装対象サブセット)
3. [ルーティング解釈（最重要）](#3-ルーティング解釈最重要)
4. [寛容パーサ要件](#4-寛容パーサ要件)
5. [テストケース案](#5-テストケース案)
6. [参考文献リスト](#6-参考文献リスト)

---

## 1. Flexの全体像

### 1.1 GTFS-Flexとは何か

GTFS-Flexは、需要応答型交通（Demand Responsive Transportation, DRT。日本の「デマンド交通」に相当）をトリップ検索アプリで発見可能にするためのGTFS拡張である。2013年にBrian Ferris（Google）が原案を書き、2018年からMobilityDataがスチュワードとなって開発が続けられ、**2024年3月に大部分がGTFS本体仕様に正式採択された**（PR #433）。本書執筆時点（2026年7月）でも仕様は成長中の分野であり、`safe_duration_factor`/`safe_duration_offset`のような追加フィールドが最近追加されている。

GTFS-Flexが想定するサービス形態は次の4種類である（公式Flexページの記述）。

- **Dial-a-ride service（呼び出し乗車サービス）**: 車両がゾーンに対して運行し、サービス時間帯の間、ゾーン内のどこでも乗車・降車できる。
- **Route deviation services（ルート逸脱サービス）**: 車両は固定ルート・固定停留所順を運行するが、停留所間で乗客の乗降のために迂回することがある。
- **Point-to-zone service（地点⇄ゾーンサービス）**: 利用者は駅などの固定停留所で乗車し、エリア内の任意の場所で降車する（またはその逆）。
- **Point deviation / checkpoint service（地点逸脱／チェックポイントサービス）**: 利用者は固定停留所で乗車し、順序のない停留所リストの中の任意の場所で降車する（またはその逆）。運転手はリクエストがあった停留所のみサービスする。

瑞穂町チョイソコみずほまちは、この中の「Dial-a-ride service」に近いが、GTFS上のモデリング方法としては後述する「location_group型（停留所グルーピング方式）」を採用している（ゾーンをポリゴンで定義するのではなく、120個の既存停留所をひとまとめのグループとして扱う）。

### 1.2 固定時刻表GTFSとの違い

| 観点 | 固定時刻表GTFS | GTFS-Flex |
|---|---|---|
| `stop_times.txt`の時刻 | `arrival_time`/`departure_time`が必須（始発・終着は必須、中間は推奨） | `start_pickup_drop_off_window`/`end_pickup_drop_off_window`で「サービス提供時間帯」を表現。`arrival_time`/`departure_time`とは**排他**（両方同時に定義することは禁止） |
| 乗降位置 | `stop_id`で個別の停留所を指定 | `stop_id`（個別停留所）に加えて、`location_group_id`（停留所のグループ）または`location_id`（GeoJSONポリゴンゾーン）を指定できる |
| 2点間の移動時間 | `stop_times`の各行の時刻差から機械的に算出可能 | ゾーン内・グループ内の2点間移動時間の情報は**そももそもGTFS-Flexに存在しない**（後述3.2節で詳述） |
| 予約 | 通常不要（乗り放題） | `booking_rules.txt`で事前予約要否・締切を定義することが多い |
| ルーティング上の1トリップの意味 | 「決まった時刻に決まった停留所を順に通る1回の運行」 | 「ある時間窓の間、指定エリア内でリクエストに応じて乗降する1つのサービス単位」。個別の発車時刻という概念自体が存在しない場合が多い |

### 1.3 3つの表現パターン

GTFS-Flexでは、乗降可能な場所を3つの方法のいずれかで表現できる。3つは排他的であり、同一の`stop_times.txt`の1行につきどれか1つだけを使う（`stop_id`, `location_group_id`, `location_id`は互いに"Conditionally Forbidden"の関係にある。詳細は2.3節）。

#### ① locations.geojsonゾーン型

`locations.geojson`にPolygon/MultiPolygonでゾーンを定義し、`stop_times.location_id`でそのゾーンを参照する。利用者はポリゴン内の任意の地点で乗降をリクエストできる（自由な緯度経度指定）。公式サンプルの「On-demand services within a single zone」「On-demand services across multiple zones」「Deviated route」がこの方式を使う。

- 長所: 停留所を事前に列挙する必要がなく、真にゾーン内の任意地点をカバーできる。道路網や住宅立地に応じた自由な形のエリアを表現できる。
- 短所: パーサ側でGeoJSON（RFC 7946のサブセット）を扱う必要がある。ルーティング側では点がポリゴン内に含まれるかの判定（point-in-polygon）が必要になる。

#### ② location_groups型（停留所グルーピング方式）

`location_groups.txt`でグループを定義し、`location_group_stops.txt`で既存の`stops.txt`上の停留所をグループに紐づける。`stop_times.location_group_id`でそのグループを参照する。利用者は「グループに属するどの停留所でも」乗降をリクエストできるが、乗降位置自体は**既存の離散的な停留所のリスト**に限定される（自由な緯度経度ではない）。公式サンプルの「On-demand services where riders must be picked up and dropped off at specific locations」（ドイツRufBus 476系統の例）がこの方式である。

- 長所: 既存の`stops.txt`の停留所を再利用できるため、固定路線GTFSとの統合（乗換ノードの特定等）が単純になる。GeoJSONパーサが不要。
- 短所: サービスエリアの境界が「あらかじめ列挙された停留所の集合」でしか表現できない。停留所間の道なき道での乗降はモデル化できない。

#### ③ 従来stopの時間窓型

既存の個別`stop_id`（固定路線と同じ`stops.txt`のエントリ）に対して、`arrival_time`/`departure_time`ではなく`start_pickup_drop_off_window`/`end_pickup_drop_off_window`を設定する。1つの決まった停留所において「この時間帯の間はいつでも乗降リクエストできる」ことを表す。route deviation型サービスにおいて、固定停留所区間の間に挟む形で使われることが多い（公式サンプルの「Deviated route」参照。stop_sequence奇数行が固定`stop_id`＋`arrival_time`、偶数行が`location_id`ゾーン＋時間窓、という交互パターン）。

#### 瑞穂町/日本のチョイソコ系で使われるパターンの判定

**瑞穂町チョイソコみずほまちのデータは②location_group型を採用している。**

判定根拠（`/sessions/compassionate-blissful-turing/mnt/ODPT2026/data/gtfs-flex/mizuho/extracted/`の実データより）:
- `locations.geojson`ファイルは**存在しない**（ディレクトリ内探索で確認済み）。したがって①は使われていない。
- `location_groups.txt`（1行: `location_group_id=mizuhomachi_group`）と`location_group_stops.txt`（120行、`mizuhomachi_group`に町内全120停留所を紐づけ）が存在する。
- `stop_times.txt`の列に`location_group_id`が存在し、`stop_id`列自体は存在しない。したがって③（従来stopの時間窓型）でもない。

日本の「チョイソコ」ブランド（アイシン系、複数自治体で導入）は、多くの場合「既存の停留所（自治会館・医療機関・商業施設等の生活拠点）を地域で決めておき、その中のどこからどこへでも予約制で移動できる」というサービス設計であるため、GTFSモデリングとしても②location_group型と非常に整合的である。9自治体分のチャレンジ限定データが将来提供された場合も、同種の「地域の合意で決めた停留所リストをひとまとめにする」設計が主流になる可能性が高いと推測される（要確認: 実際に9自治体データを入手した時点で、location_group型以外（GeoJSONゾーン型や、複数グループに分割されているパターン）が混在する可能性は排除できない。パーサは3パターン全てに対応できる設計にすべき。詳細は4章）。

---

## 2. ファイル・列リファレンス（実装対象サブセット）

本章は公式リファレンス（gtfs.org/documentation/schedule/reference/、2026-07-02取得）の定義に基づく。各列について、瑞穂町データでの実際の値を併記する。

### 2.1 locations.geojson

**ファイルPresence: Optional**

RFC 7946のサブセットを使うGeoJSON `FeatureCollection`。瑞穂町データには存在しないため実装上は「空／未提供」を正しく扱えることが必須要件になる（パーサは本ファイルが無いことをエラーにしてはならない）。

構造（MobilityData原提案文書および公式ページの記述に基づく。この構造は正式採択後も変更されていない）:

| フィールド | 型 | 必須/任意 | 説明 |
|---|---|---|---|
| `type` | String | 必須 | `"FeatureCollection"`固定 |
| `features` | Array | 必須 | `Feature`オブジェクトの配列 |
| `features[].type` | String | 必須 | `"Feature"`固定 |
| `features[].id` | String | 必須 | ロケーションID。`stops.stop_id`と同一の名前空間に属する。**`stops.stop_id`と同じ値を`locations.geojson`の`id`に使うことは禁止** |
| `features[].properties` | Object | 必須 | プロパティ格納用オブジェクト（空オブジェクト`{}`でも可） |
| `features[].properties.stop_name` | String | 任意 | 利用者向けに表示するロケーション名 |
| `features[].properties.stop_desc` | String | 任意 | ロケーションの説明 |
| `features[].properties.zone_id` | String | `fare_rules.txt`がある場合は必須、それ以外は任意 | 運賃ゾーンの識別子 |
| `features[].properties.stop_url` | URL | 任意 | ロケーションについてのWebページURL |
| `features[].geometry` | Object | 必須 | ジオメトリ |
| `features[].geometry.type` | String | 必須 | `"Polygon"`または`"MultiPolygon"`のみ許可（Point, LineString等は不可） |
| `features[].geometry.coordinates` | Array | 必須 | 緯度経度の座標配列（GeoJSON標準の`[lon, lat]`順） |

瑞穂町での実値: 該当ファイル自体が存在しないため「該当なし」。

### 2.2 location_groups.txt

**ファイルPresence: Optional**

「グループに属する停留所のどこでも乗降リクエストできる」ことを示す、停留所のグルーピングを定義するファイル。

| 列名 | 型 | 必須/任意 | 意味 | 瑞穂町での実値 |
|---|---|---|---|---|
| `location_group_id` | Unique ID | 必須 | グループを一意に識別するID。この値は`stops.stop_id`・`locations.geojson`の`id`とも重複してはならない名前空間に属する（`stops.txt`の`stop_id`定義に「IDはstops.stop_id, locations.geojson id, location_groups.location_group_idの全体でユニークでなければならない」と明記） | `mizuhomachi_group`（1行のみ） |
| `location_group_name` | Text | 任意 | 利用者向けに表示するグループ名 | `瑞穂町全乗降場` |

Primary keyは`location_group_id`（1行1グループ）。瑞穂町データはグループが1つしかない最も単純な構成だが、実装上は複数グループが混在するケース（例: 東側グループ・西側グループに分割されている）にも対応できる汎用設計にすること。

（要確認: `location_group_id`・`location_group_name`個々のConditionally Required等の詳細な条件文言は、gtfs.org公式ページの取得試行がツール側の出力上限により該当セクションに到達できず、一字一句の確認ができていない。列名・役割・Primary keyは`gtfs.org/getting-started/features/flexible-services/`の「Fixed-Stops Demand Responsive Services」節および複数の公式サンプルデータで確認済みであり信頼性は高いが、細かいPresence文言のみ要確認扱いとする。）

### 2.3 location_group_stops.txt

**ファイルPresence: Optional**

`location_groups.txt`で定義したグループに、既存`stops.txt`の停留所を割り当てるファイル。

| 列名 | 型 | 必須/任意 | 意味 | 瑞穂町での実値 |
|---|---|---|---|---|
| `location_group_id` | Foreign ID referencing `location_groups.location_group_id` | 必須 | 割り当て先のグループ | 全120行とも`mizuhomachi_group`固定 |
| `stop_id` | Foreign ID referencing `stops.stop_id` | 必須 | グループに属する停留所 | 1〜120の連番。重複・欠落なし |

Primary keyは`(location_group_id, stop_id)`の組。1つの`stop_id`が複数の`location_group_id`に属することも許される（重複登録が可能）。瑞穂町データでは全120停留所が単一グループに1回ずつ登場する。

### 2.4 booking_rules.txt

**ファイルPresence: Optional**

需要応答型サービスの予約方法・締切を定義する。公式定義（MobilityData原提案文書=GTFS本体採択の元テキスト。列名・値の意味は正式採択後も変更なし。gtfs.org公式Flexible servicesページに掲載の列名一覧と完全一致）。

| 列名 | 型 | 必須/任意 | 意味 | 瑞穂町での実値 |
|---|---|---|---|---|
| `booking_rule_id` | ID | **必須** | ルールを一意に識別するID | `general`（1行のみ） |
| `booking_type` | Enum | **必須** | 予約可能なタイミングの種類。値の意味は下記2.4.1で詳述 | `1`（当日事前予約） |
| `prior_notice_duration_min` | Integer | `booking_type=1`のとき必須、それ以外は禁止 | 乗車の何分前までに予約が必要か（最小分数） | `30` |
| `prior_notice_duration_max` | Integer | `booking_type=0`と`2`では禁止、`1`では任意 | `booking_type=1`において、それより前には予約できない上限分数（早すぎる予約を制限） | 未設定（列自体なし） |
| `prior_notice_last_day` | Integer | `booking_type=2`のとき必須、それ以外は禁止 | 乗車日の何日前までに予約が必要か。例:「1日前の17時まで」なら`1` | 未設定（列自体なし） |
| `prior_notice_last_time` | Time | `prior_notice_last_day`が定義されていれば必須、それ以外は禁止 | `prior_notice_last_day`で指定した日の何時までか。例:「1日前の17時まで」なら`17:00:00` | 未設定（列自体なし） |
| `prior_notice_start_day` | Integer | `booking_type=0`では禁止。`booking_type=1`かつ`prior_notice_duration_max`定義済みの場合は禁止。それ以外は任意 | 何日前から予約を開始できるか（最も早い予約可能日）。例:「1週間前の深夜0時から予約可」なら`7` | 未設定（列自体なし） |
| `prior_notice_start_time` | Time | `prior_notice_start_day`が定義されていれば必須、それ以外は禁止 | `prior_notice_start_day`の日の何時から予約可能か | 未設定（列自体なし） |
| `prior_notice_service_id` | ID referencing `calendar.service_id` | `booking_type=2`では任意、それ以外は禁止 | `prior_notice_last_day`/`prior_notice_start_day`の「日数」を数える際の基準となる営業日カレンダー（空の場合は暦日でカウント） | 未設定（列自体なし） |
| `message` | Text | 任意 | 乗車・降車両方に適用される利用案内メッセージ（自由文） | `ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付` |
| `pickup_message` | Text | 任意 | 乗車のみに適用される案内文（`message`と同様の働きだが乗車限定） | 未設定（列自体なし） |
| `drop_off_message` | Text | 任意 | 降車のみに適用される案内文 | 未設定（列自体なし） |
| `phone_number` | Phone number | 任意 | 予約用電話番号 | `050-2030-2630` |
| `info_url` | URL | 任意 | 予約ルールについての案内URL | `https://www.town.mizuho.tokyo.jp/` |
| `booking_url` | URL | 任意 | オンライン予約用URL | 空文字（列は存在するが値なし） |

#### 2.4.1 booking_typeの正確な値の意味と、prior_notice_*列群の組み合わせルール

`booking_type`の3値は次の意味を持つ（公式定義を直訳、意訳は避ける）。

- `0` = **Real time booking**（リアルタイム予約）: 乗車直前でも即座に予約可能。事前通知期間の概念がないため、`prior_notice_*`系の列は原則すべて禁止（`prior_notice_start_day`のみ明示的に「forbidden for booking_type=0」と記載。他の`prior_notice_duration_min`/`max`/`last_day`等も、それぞれの列の条件文により実質的に使えない）。
- `1` = **Up to same-day booking with advance notice**（当日中・一定時間前までの事前予約): 乗車したい時刻の「n分前まで」に予約すればよい。`prior_notice_duration_min`が必須（このnの値）。上限を設けたい場合は`prior_notice_duration_max`を任意で追加できる（「早すぎる予約はできない」制約）。瑞穂町データはこの値。
- `2` = **Up to prior day(s) booking**（前日以前の予約）: 乗車日より前の日に予約を締め切る。`prior_notice_last_day`＋`prior_notice_last_time`のペアが必須（「何日前の何時まで」という締切）。任意で`prior_notice_start_day`＋`prior_notice_start_time`のペアを追加すると「何日前の何時から予約開始」という受付開始時刻も表現できる。

組み合わせルールをコード化する際の要点:

```
booking_type = 0 の場合:
  → prior_notice_* 系はすべて未設定であるべき（設定されていれば仕様違反、寛容パーサは警告のみで継続）
  → 探索結果には「即時予約可・特別な締切なし」と案内する

booking_type = 1 の場合:
  → prior_notice_duration_min が必須（未設定なら仕様違反、ただし寛容パーサは欠損値として扱い「締切不明」の案内にフォールバックする）
  → 締切時刻 = 希望乗車時刻 − prior_notice_duration_min 分
  → prior_notice_duration_max があれば、「希望乗車時刻 − prior_notice_duration_max 分」より前の予約は不可（早すぎる予約の制限）
  → 瑞穂町の例: prior_notice_duration_min=30 なので、9:00発を希望するなら8:30までに予約が必要

booking_type = 2 の場合:
  → prior_notice_last_day + prior_notice_last_time が必須
  → 締切時刻 = (乗車日 − prior_notice_last_day 日)の prior_notice_last_time
  → prior_notice_service_id が設定されていれば、日数のカウントはそのservice_idの運行日（営業日）ベースで行う。未設定なら暦日でカウント
  → 任意で prior_notice_start_day + prior_notice_start_time があれば、それより前の予約は不可
```

瑞穂町データでは`booking_type=1`、`prior_notice_duration_min=30`のみが設定されており、`prior_notice_duration_max`・`prior_notice_last_day`系・`prior_notice_start_day`系はすべて列自体が存在しない（欠損）。これは`booking_type=1`の必須要件（`prior_notice_duration_min`）だけを満たした最小構成であり、仕様違反ではない。

一方、「電話予約は8:30から16:30まで」という受付時間帯は、`prior_notice_start_time`（予約可能な最も早い時刻）に相当しそうに見えるが、実際には`prior_notice_start_day`が未設定のため`prior_notice_start_time`も設定できない（`prior_notice_start_time`は`prior_notice_start_day`が定義されていれば必須、そうでなければ禁止という条件のため）。したがってこの「8:30-16:30」という制約は構造化列では表現されておらず、**`message`列の自由文にのみ存在する**（3.4節で扱う）。

### 2.5 stop_times.txtのFlex拡張列

**ファイルPresence: Required**（ファイル自体は元から必須。Flexで拡張列が追加された）

Primary key: `(trip_id, stop_sequence)`

| 列名 | 型 | 必須/任意 | 意味 | 瑞穂町での実値 |
|---|---|---|---|---|
| `stop_id` | Foreign ID referencing `stops.stop_id` | `location_group_id`・`location_id`のいずれも未定義なら必須、いずれかが定義されていれば禁止 | 個別停留所を指定する従来型の列 | 使用されていない（列自体存在しない） |
| `location_group_id` | Foreign ID referencing `location_groups.location_group_id` | `stop_id`・`location_id`が定義されていれば禁止 | ②location_group型でグループを参照 | 全4行とも`mizuhomachi_group` |
| `location_id` | Foreign ID referencing `locations.geojson`の`id` | `stop_id`・`location_group_id`が定義されていれば禁止 | ①GeoJSONゾーン型でゾーンを参照 | 使用されていない（列自体存在しない） |
| `stop_sequence` | Non-negative integer | 必須 | トリップ内の順序。増加していれば連番でなくてもよい。同一グループ／ゾーン内の移動を表すには、同じ`location_group_id`/`location_id`を持つ行が2つ必要（3.3節で詳述） | 各tripで`1`, `2`の2行 |
| `arrival_time` | Time | 最初と最後の停留所では必須（`start/end_pickup_drop_off_window`が定義されていれば禁止） | 到着時刻 | 使用されていない（**列自体が存在しない**。瑞穂町データはstop_timesの全4行が時間窓方式のため） |
| `departure_time` | Time | 上記と同様 | 出発時刻 | 使用されていない（**列自体が存在しない**） |
| `start_pickup_drop_off_window` | Time | `location_group_id`または`location_id`が定義されていれば必須。`end_pickup_drop_off_window`が定義されていれば必須。`arrival_time`/`departure_time`が定義されていれば禁止 | オンデマンドサービスが利用可能になる時刻 | 全4行とも`09:00:00` |
| `end_pickup_drop_off_window` | Time | 上記と対になる条件 | オンデマンドサービスが終了する時刻 | 全4行とも`17:00:00` |
| `pickup_type` | Enum | `start/end_pickup_drop_off_window`が定義されている場合、値`0`と`3`は禁止 | 乗車方法。値の意味は下記2.5.1 | 行ごとに`2`または`1` |
| `drop_off_type` | Enum | `start/end_pickup_drop_off_window`が定義されている場合、値`0`は禁止 | 降車方法。値の意味は下記2.5.1 | 行ごとに`1`または`2` |
| `pickup_booking_rule_id` | Foreign ID referencing `booking_rules.booking_rule_id` | 任意（`pickup_type=2`のとき設定が推奨） | この行での乗車に適用される予約ルール | 乗車専用行のみ`general`、降車専用行は空 |
| `drop_off_booking_rule_id` | Foreign ID referencing `booking_rules.booking_rule_id` | 任意（`drop_off_type=2`のとき設定が推奨） | この行での降車に適用される予約ルール | 降車専用行のみ`general`、乗車専用行は空 |
| `timepoint` | Enum | 任意 | 時刻が厳密（`1`）か推定（`0`）か | 全4行とも`1` |
| `mean_duration_factor` / `mean_duration_offset` | Float | `stop_idがlocation_group_id/location_idを参照しない場合は禁止`（提案文書時点の定義。正式版での存在は要確認） | ゾーン/グループ内の**平均**移動時間を推定するための係数・オフセット。`MeanTravelDuration = mean_duration_factor × DrivingDuration + mean_duration_offset` | 未設定（列自体なし） |
| `safe_duration_factor` / `safe_duration_offset` | Float | 同上 | ゾーン/グループ内の移動時間の**95パーセンタイル（安全側の上限）**を推定するための係数・オフセット。`SafeTravelDuration = safe_duration_factor × DrivingDuration + safe_duration_offset` | 未設定（列自体なし） |

（`mean_duration_factor`系・`safe_duration_factor`系は`trips.txt`側にも同名の列が存在し、トリップ全体に対するデフォルト値として機能する。瑞穂町データではいずれも未設定。これらの列は2024年3月の正式採択以降に追加された比較的新しいフィールドであり、9自治体データでも未提供である可能性が高い。3.2節で移動時間推定の代替手段を扱う理由はここにある。）

#### 2.5.1 pickup_type / drop_off_typeの値の正確な意味

両者共通のEnum値（`stop_times.txt`, `routes.txt`の`continuous_pickup`/`continuous_drop_off`とは別の列である点に注意）:

| 値 | pickup_typeの意味 | drop_off_typeの意味 |
|---|---|---|
| `0`または空 | 定時運行の通常の乗車（Regularly scheduled pickup） | 定時運行の通常の降車（Regularly scheduled drop off） |
| `1` | **乗車不可**（No pickup available） | **降車不可**（No drop off available） |
| `2` | **要電話予約**（Must phone agency to arrange pickup） | **要電話予約**（Must phone agency to arrange drop off） |
| `3` | **運転手との調整が必要**（Must coordinate with driver to arrange pickup） | **運転手との調整が必要**（Must coordinate with driver to arrange drop off） |

制約: `start_pickup_drop_off_window`/`end_pickup_drop_off_window`が定義されている行では、`pickup_type=0`（禁止）と`pickup_type=3`（禁止）は使えない。つまり時間窓方式の行における`pickup_type`は実質的に`1`（乗車不可）か`2`（要予約）のいずれかにしかならない。`drop_off_type`については`0`のみが禁止（`3`は許容される。route deviation型のような「運転手と調整して降車」を許すケースがあるため）。

瑞穂町データの4行はいずれも`pickup_type∈{1,2}`、`drop_off_type∈{1,2}`のみで構成されており、この制約と整合している。

### 2.6 On-demand Service Routing Behavior（ルーティング解釈の公式ルール）

公式リファレンスの`stop_times.txt`セクション末尾に、ルーティング実装が守るべき2つの規則が明記されている。これは実装上非常に重要なため、原文の意味を正確に転記する。

1. **中間の時間窓レコードは無視する**: 出発地から目的地までの経路や移動時間を算出する際、データ利用側（本エンジン）は、同一`trip_id`内にある「`start_pickup_drop_off_window`と`end_pickup_drop_off_window`が定義された中間のstop_timesレコード」を無視しなければならない。

   公式サンプルの例（`tripA`が`Zone1→Zone2→Zone3`の3ゾーンを持つ場合）:
   ```
   trip_id | location_id | stop_sequence | pickup_type | drop_off_type | window開始 | window終了
   tripA   | Zone1       | 1             | 2           | 1              | 08:00:00   | 18:00:00
   tripA   | Zone2       | 2             | 1           | 2              | 08:00:00   | 14:00:00
   tripA   | Zone3       | 3             | 1           | 2              | 10:00:00   | 18:00:00
   ```
   `Zone1`から`Zone3`への移動を検索する場合、中間の`Zone2`（stop_sequence=2）は無視してよい。すなわち「Zone1で乗ってZone3で降りる」という直接の1レッグとして扱ってよく、Zone2を経由する必要はない（Zone2はpickup_type=1のため乗車もできないので、そもそも経由不可能でもある）。

2. **ゾーン重複の禁止**: 同一`trip_id`内で、2つ以上のstop_timesレコードが「`locations.geojson`のジオメトリ」「`start/end_pickup_drop_off_window`の時間帯」「`pickup_type`または`drop_off_type`」の3条件すべてにおいて**同時に重複することは禁止**されている。禁止例と許容例は公式サンプルで、時間帯を分離する（重複時間帯をなくす）か、ジオメトリが異なる（親子関係にあるゾーンでも別ジオメトリなら重複とみなされない）ことで回避できる、と示されている。パーサ・バリデータはこの制約への違反を検出できることが望ましいが、瑞穂町のような小規模フィードでは同一trip内に複数ゾーンが存在しないため、この制約が発火する場面はない。

---

## 3. ルーティング解釈（最重要）

本章はFlexトリップを経路探索（RAPTORベースのエンジン）でどう扱うかを定める。

### 3.1 location_group型の仮想レッグ化

location_group型のトリップ（瑞穂町のような構成）は、次の手順で「グループ内の任意の乗車点→任意の降車点」を結ぶ仮想レッグとしてモデル化する。

**ステップ1: グループの展開**

`location_group_stops.txt`を読み、`location_group_id`ごとに所属`stop_id`の集合を構築する（`Map<location_group_id, Set<stop_id>>`）。瑞穂町なら`mizuhomachi_group → {1, 2, ..., 120}`という1エントリのマップになる。

**ステップ2: 乗車専用行・降車専用行の対応付け**

同一`trip_id`内で、同じ`location_group_id`を参照する2行（stop_sequenceが連続する乗車行・降車行のペア）を見つけ、それぞれの`start/end_pickup_drop_off_window`・`pickup_booking_rule_id`／`drop_off_booking_rule_id`を取得する。判定ロジックは3.3節。

**ステップ3: 仮想レッグの生成**

グループに属する停留所の任意の2点`(stopA, stopB)`（`stopA ≠ stopB`）の組み合わせについて、次の情報を持つ仮想的な「Flexレッグ」を生成する（実際に120×119通りを事前に全展開するのではなく、探索時にオンデマンドで生成する遅延評価が望ましい。4.5節参照）。

```typescript
interface FlexLeg {
  kind: "flex";
  tripId: string;
  locationGroupId: string;       // または locationId（ゾーン型の場合）
  fromStopId: string;
  toStopId: string;
  windowStart: GtfsTime;         // start_pickup_drop_off_window
  windowEnd: GtfsTime;           // end_pickup_drop_off_window
  estimatedDurationSec: number;  // 3.2節の推定方法で算出
  pickupBookingRuleId?: string;
  dropOffBookingRuleId?: string;
  serviceId: string;             // calendar.txt/calendar_dates.txtでの運行日判定に使う
}
```

このレッグが利用可能なのは、利用者の希望出発時刻（または希望到着時刻）が`[windowStart, windowEnd]`区間に収まり、かつ当該サービス日（`serviceId`）が有効であり、かつ予約締切に間に合う場合のみである（3.4節）。

ゾーン型（①locations.geojson）の場合は、`fromStopId`/`toStopId`の代わりに「利用者が指定した緯度経度がポリゴン内に含まれるか」の判定（point-in-polygon）に置き換わる。この場合、経路探索の起点・終点は駅やバス停ではなく任意の緯度経度になるため、access/egressレッグとして扱う（3.5節）。

### 3.2 グループ内の所要時間推定問題

**GTFS-Flexには2点間の所要時間を直接与える情報が（多くの場合）存在しない。** `mean_duration_factor`/`mean_duration_offset`・`safe_duration_factor`/`safe_duration_offset`という推定用の係数フィールドが仕様上は用意されているが、これらは「実際の道路距離で走る時間（`DrivingDuration`）」に係数・オフセットを掛け合わせて補正するためのものであり、その`DrivingDuration`自体を求める手段はGTFS-Flexの外（道路網ルーティングAPI等）に依存する。さらに瑞穂町データにはこれらの係数フィールド自体も存在しない（2.5節参照）。

したがって、パーサ・ルーティングエンジンは何らかの独自の推定ロジックを持つ必要がある。選択肢を以下に列挙する。

**選択肢A: 直線距離×迂回係数÷平均速度（推奨・第一実装）**

```
distance_m = haversine(stopA.lat, stopA.lon, stopB.lat, stopB.lon)
drivingDuration_sec = (distance_m × detourFactor) / averageSpeed_mps
```

- `detourFactor`（迂回係数）: 直線距離に対する実際の道路距離の比率。日本の郊外・住宅地では**1.3〜1.5程度**が経験的な目安（都市部の格子状道路網なら1.2〜1.3、山間部・入り組んだ住宅地なら1.5〜1.8）。瑞穂町は東京都西部の丘陵地で住宅地が多いため、**推奨値: 1.4**とする。
- `averageSpeed_mps`（デマンド交通の平均走行速度）: 乗合バス・デマンド交通は信号待ち・他の乗客の乗降のための停車を挟むため、一般道路の巡航速度より低い。国内のデマンド交通の実運用データでは概ね**時速20〜25km**程度が多いとされる。**推奨値: 時速22km（≒6.1 m/s）**とする。
- 推定式の適用例（瑞穂町、bbox: 緯度35.74723〜35.79363、経度139.32490〜139.36645、南北約5km×東西約3.5km）: 町内の対角距離は直線で約6km程度。迂回係数1.4を掛けると約8.4km。時速22kmなら約23分。実際のサービス時間帯（9:00〜17:00の8時間）に対して十分小さい値であり、この推定方法は妥当と考えられる。
- 実装注意: この推定値はあくまで「概算の移動時間」であり、後述3.4節の予約締切判定や、探索結果の「到着予定時刻」表示にのみ使う。**実際の運行時刻を保証するものではない**ため、案内文には「目安」「予定」等の語を必ず添える（5章のテストケースで検証）。

**選択肢B: 固定値（グループ全体で1つの定数、簡易実装向け）**

グループ内のどの2点間でも一律の固定時間（例: 20分）を使う。実装が最も簡単だが、グループの地理的な広がりが大きい場合（瑞穂町のように町全体をカバーするグループ）、近距離の移動と遠距離の移動を区別できず、乗換時刻の見積もりが粗くなる。プロトタイプの最初のステップとしては許容できるが、MVP以降では選択肢Aへの切り替えを推奨。

**選択肢C: 外部ルーティングAPI連携（高精度・要追加コスト）**

OSRM、Google Maps Directions API、GraphHopper等の道路網ルーティングエンジンに`stopA`→`stopB`の実際の走行時間を問い合わせる。最も精度が高いが、120停留所×119通りのペアを全て事前計算するとAPI呼び出し数が多くなる（瑞穂町だけで14,280通り）。低コスト制約（本プロジェクトの前提、`06_合体案_ノリシロxMCP_低コスト構成.md`参照）と相性が悪いため、**本実装では選択肢Aを既定とし、選択肢Cは将来の精度向上オプションとして設計上の余地だけ残す**（`estimatedDurationSec`を計算する関数をインターフェースとして切り出し、A/B/Cを差し替え可能にする）。

```typescript
interface DurationEstimator {
  estimate(from: StopLike, to: StopLike): number; // seconds
}

// 既定実装（選択肢A）
class HaversineDurationEstimator implements DurationEstimator {
  constructor(
    private detourFactor = 1.4,
    private averageSpeedMps = 22 * 1000 / 3600, // 時速22km
  ) {}
  estimate(from: StopLike, to: StopLike): number {
    const distanceM = haversineDistance(from, to);
    return (distanceM * this.detourFactor) / this.averageSpeedMps;
  }
}
```

`mean_duration_factor`/`safe_duration_factor`が将来データに存在する場合は、このHaversine推定値を`DrivingDuration`とみなして係数を掛け合わせるハイブリッド方式に切り替える（存在すればそちらを優先、存在しなければHaversine推定値をそのまま採用）。

### 3.3 乗車専用行・降車専用行の判定ロジック

同一`trip_id`・同一`location_group_id`（またはlocation_id）を持つstop_times行のうち、以下の条件に合致する行を「乗車専用行」「降車専用行」と判定する。

```typescript
type RowRole = "pickup_only" | "dropoff_only" | "both" | "neither";

function classifyStopTimeRow(row: FlexStopTimeRow): RowRole {
  const canPickup = row.pickupType === 2 || row.pickupType === 3 || row.pickupType === 0 || row.pickupType === undefined;
  const canDropoff = row.dropOffType === 2 || row.dropOffType === 3 || row.dropOffType === 0 || row.dropOffType === undefined;
  const noPickup = row.pickupType === 1;
  const noDropoff = row.dropOffType === 1;

  if (noDropoff && !noPickup) return "pickup_only";
  if (noPickup && !noDropoff) return "dropoff_only";
  if (!noPickup && !noDropoff) return "both";
  return "neither"; // pickupType=1 かつ dropOffType=1 は通過のみ（乗降不可）の異常系。3.1のグループ内では通常発生しない
}
```

**瑞穂町の4行での適用例**:

| trip_id | stop_sequence | pickup_type | drop_off_type | 判定 |
|---|---|---|---|---|
| east_trip | 1 | 2（要予約） | 1（不可） | `pickup_only`（乗車専用行） |
| east_trip | 2 | 1（不可） | 2（要予約） | `dropoff_only`（降車専用行） |
| west_trip | 1 | 2（要予約） | 1（不可） | `pickup_only`（乗車専用行） |
| west_trip | 2 | 1（不可） | 2（要予約） | `dropoff_only`（降車専用行） |

各tripにつき`pickup_only`行が1つ、`dropoff_only`行が1つ、という組が見つかったら、これを3.1節の「ステップ2」で言うペアとして採用する。`pickup_only`行の`pickup_booking_rule_id`が乗車時の予約ルール、`dropoff_only`行の`drop_off_booking_rule_id`が降車時の予約ルールになる（瑞穂町では両方とも`general`で同一ルールだが、一般的には異なるルールIDが設定される可能性があるため、必ず行ごとに読み分けること）。

汎用化の注意点: 本ロジックは「1トリップに乗車専用行1つ・降車専用行1つの合計2行」という瑞穂町の構成を前提にしていない（既存検分レポート6章の指摘通り、行数を固定長で仮定するとデータの改修で破綻する）。実装は「同一`location_group_id`（または`location_id`）を持つ行を全て集め、その中で`pickup_only`と`dropoff_only`をそれぞれ抽出する」という汎用ロジックにすること。1つのグループに対して`pickup_only`が複数存在する場合（例: 異なる時間窓を持つ複数のpickup_only行）も想定し、時間窓ごとに個別のFlexLegを生成できるようにする。

### 3.4 予約制約の扱い

`booking_type=1`・`prior_notice_duration_min=30`（瑞穂町の例）の場合、「出発希望時刻の30分前まで予約可」という制約を、探索結果の実行可能性判定と案内文の両方に反映する。

**実行可能性判定（フィルタリングロジック）**:

```typescript
function isBookingFeasible(
  leg: FlexLeg,
  desiredDepartureTime: GtfsTime,
  now: GtfsDateTime,
  bookingRule: BookingRule,
): { feasible: boolean; deadline?: GtfsDateTime; reason?: string } {
  if (bookingRule.bookingType === 0) {
    // リアルタイム予約: 締切なし、常に可
    return { feasible: true };
  }
  if (bookingRule.bookingType === 1) {
    const minutes = bookingRule.priorNoticeDurationMin;
    if (minutes === undefined) {
      // 寛容パーサ: 必須フィールドが欠損している場合は「締切不明」としてフォールバック
      return { feasible: true, reason: "prior_notice_duration_min欠損のため締切判定不可、案内のみ" };
    }
    const deadline = subtractMinutes(desiredDepartureTime, minutes);
    if (isAfter(now, deadline)) {
      return { feasible: false, deadline, reason: `締切(${formatTime(deadline)})を過ぎているため予約不可` };
    }
    return { feasible: true, deadline };
  }
  if (bookingRule.bookingType === 2) {
    // prior_notice_last_day + prior_notice_last_time から締切日時を計算
    const deadline = computeDeadlineForType2(desiredDepartureTime, bookingRule);
    if (isAfter(now, deadline)) {
      return { feasible: false, deadline, reason: `${formatDate(deadline)} ${formatTime(deadline)}までの予約が必要` };
    }
    return { feasible: true, deadline };
  }
  return { feasible: true }; // bookingType未定義（寛容パーサのフォールバック）
}
```

瑞穂町の例（火曜10:00発を希望し、現在時刻が同日9:00の場合）: `deadline = 10:00 − 30分 = 09:30`。現在時刻9:00は09:30より前なので`feasible: true`、`deadline: 09:30`。案内文は「予約締切: 09:30まで」と表示する（5章テストケース参照）。現在時刻が9:45であれば`feasible: false`、「予約締切(09:30)を過ぎているため、この時刻の利用はできません」という案内に切り替える。

**探索結果への反映方法**: RAPTORの各ラウンドでFlexLegを候補として追加する際、`isBookingFeasible`が`false`を返すレッグは到達可能な経路として採用しない（3.5節）。ただし、UIで「あと数分早く予約すれば利用できた」ことをユーザーに伝える価値があるため、実行不可能なレッグも「参考情報」として別途保持し、案内文に含めることを推奨する（例:「この時間の利用には09:30までの予約が必要でした」）。

**案内文への反映**: 予約ルールの`message`列（自由文）は、探索結果に付随する案内テキストとしてそのまま利用者に提示する。瑞穂町の例では「ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付」という文字列全体を、締切時刻の計算結果（09:30等の具体値）と併せて表示する。`message`が電話受付時間帯という構造化されていない補足情報を含んでいる点に留意し、構造化フィールドから計算した締切時刻と、`message`の自由文の両方を並べて見せる設計にする（片方だけでは情報が不完全になる。2.4.1節末尾で述べた通り、電話受付時間帯は構造化列に存在しない）。

### 3.5 固定路線RAPTORへの統合

`09_固定路線データ調査.md`が示す方針（「固定路線＝従来型RAPTOR」「Flex＝別レイヤの特殊パーサ」というレイヤ分離）を踏襲し、Flexレッグは以下のいずれかの形でRAPTORのラウンド処理に注入する。

**設計方針: Flexレッグをaccess/egress/transferの3種の「特殊エッジ」として扱う**

1. **access（出発地→最初の固定路線ノードまで、またはFlexサービスのみで完結する経路）**: 利用者の出発地点（緯度経度、または最寄りFlex停留所）から、Flexサービスが到達可能な停留所群への接続として扱う。目的地までFlexサービスのみでカバーできる場合（瑞穂町内の移動のみ等）は、accessからegressまでFlexレッグ1本で完結する特殊ケースになる。

2. **egress（最後の固定路線ノードから目的地まで）**: 固定路線バスや鉄道の最寄り停留所から、Flexサービスのカバーエリア内にある目的地までの接続として扱う。

3. **transfer（固定路線の乗換ノードとFlexサービスの間の乗換）**: `09_固定路線データ調査.md`が指摘する通り、瑞穂町のFlexデータとJR八高線・西武バス等の固定路線データとの間には直接の相互参照列が存在しないため、緯度経度ベースの近接判定（例: 300m以内、あるいはHaversine距離が閾値以下）で乗換候補ノードを自動検出する必要がある。箱根ケ崎駅のように固定路線側の時刻表データが未確保のケースでは、暫定的に「Flex停留所→箱根ケ崎駅」の単純な直行レッグとして扱い、駅から先は別ドキュメント（`13_ルーティングエンジン設計.md`）の管轄とする。

RAPTORのラウンド内での扱いは次の疑似コードに従う（RAPTORの用語: k回目の乗り換えラウンドで、各ノードの最早到達時刻`τ_k`を更新する処理に、固定路線トリップのスキャンと並んでFlexレッグのスキャンを追加する）。

```typescript
function processRound(round: number, markedStops: Set<StopId>, tau: Map<StopId, GtfsTime>) {
  // 既存の固定路線トリップ走査（省略）
  scanFixedRouteTrips(round, markedStops, tau);

  // Flexレッグの走査（本仕様書で追加する部分）
  for (const stopId of markedStops) {
    const groups = locationGroupsContaining(stopId); // stopIdが属するFlexグループを逆引き
    for (const group of groups) {
      for (const flexTrip of tripsServingGroup(group.locationGroupId)) {
        if (!isServiceActiveOn(flexTrip.serviceId, targetDate)) continue; // calendar/calendar_dates判定
        const window = getWindow(flexTrip); // start/end_pickup_drop_off_window
        if (!(tau.get(stopId) >= window.start && tau.get(stopId) <= window.end)) continue;

        for (const otherStopId of group.stopIds) {
          if (otherStopId === stopId) continue;
          const duration = durationEstimator.estimate(stopId, otherStopId);
          const arrivalTime = addSeconds(tau.get(stopId), duration);
          if (arrivalTime > window.end) continue; // 時間窓を超える到着は不可

          const bookingCheck = isBookingFeasible(/* ... */);
          if (!bookingCheck.feasible) continue; // 予約締切に間に合わない経路は採用しない

          if (arrivalTime < (tau.get(otherStopId) ?? Infinity)) {
            tau.set(otherStopId, arrivalTime);
            markedStops.add(otherStopId);
            recordJourneyLeg(otherStopId, { kind: "flex", fromStopId: stopId, toStopId: otherStopId, ... });
          }
        }
      }
    }
  }
}
```

設計上の要点:

- **コスト評価の注意**: Flexレッグは固定路線の「決まった発車時刻を待つ」コストではなく、「予約が確定してから車両が来るまでの待ち時間」という別種の不確実性を持つ。本仕様書の推定モデル（3.2節）はあくまで走行時間の推定であり、予約から実際の乗車までの待機時間（配車調整にかかる時間）は別途考慮するかどうかを設計判断として残す（要確認: 瑞穂町データにはこの待機時間の情報源がないため、v1実装では「予約確定後は時間窓内であれば即座に乗車可能」という楽観的な仮定を置き、UIの案内文で「実際の配車状況により前後する可能性があります」と明示することを推奨する）。
- **多基準最適化への配慮**: RAPTORの本来の強みである「パレート最適な複数の到着時刻・乗換回数の組」を保つため、Flexレッグを追加してもラウンドごとの最適性は崩さない設計にする（Flexレッグも1回の「乗換」としてラウンド番号を1つ消費させるのが単純で安全）。
- 本節はRAPTORへの統合の**設計指針**を示すものであり、RAPTORアルゴリズム全体の詳細実装（優先度キュー、footpath処理、複数日をまたぐ探索等）は`13_ルーティングエンジン設計.md`の管轄とする。

---

## 4. 寛容パーサ要件

パーサは、実データが公式仕様から逸脱していても最大限動作を継続し、致命的な例外を投げないことを基本方針とする（本エンジンの利用者はハッカソン参加者・自治体データ提供者であり、9自治体分のデータで異なる逸脱パターンが来る可能性が高いことを前提にする）。

### 4.1 瑞穂町データで確認済みの仕様逸脱

`07_瑞穂町Flexデータ検分.md`および実データ再確認（2026-07-02）で判明した逸脱・特筆事項:

1. **`stop_times.txt`に`arrival_time`/`departure_time`列自体が存在しない**（空文字ではなく列そのものが未定義）。GTFS-Flexの多くの実装では「列は残し、値だけを空にする」運用が一般的だが、瑞穂町データは列を丸ごと省略している。パーサはこの列の非存在を許容し、`undefined`として扱う。
2. **`booking_rules.txt`に`prior_notice_last_day`等の詳細な締切列が一切存在しない**。`booking_type=1`に必須な`prior_notice_duration_min`のみが存在し、その他の`prior_notice_*`列は列ごと欠落している。「電話予約は8:30-16:30まで」という制約は構造化列に存在せず、`message`の自由文にのみ埋め込まれている。
3. **east_trip/west_tripという2トリップの地理的な区別が実データからは確認できない**。両トリップとも同一の`location_group_id=mizuhomachi_group`（全120停留所）を参照し、`trip_headsign`もどちらも「瑞穂町全域」で同一。区別できるのは`calendar.txt`の曜日パターン（火・金・土 vs 月・水・土）のみ。
4. **1トリップあたり2行（乗車専用行・降車専用行）という極小構成**。将来的にグループが複数の時間窓に分かれる、複数のグループに分割される等の改修があった場合に、この2行固定の前提を持つパーサ実装は破綻する。
5. **`translations.txt`の翻訳がローマ字転写のみ**で意味的な英訳になっていない（Flex固有の問題ではないが、UI実装に影響する）。
6. **`booking_url`列は存在するが値が空文字**。`message`列では「オンライン予約は24時間受付」と案内されているにもかかわらず、実際のURLは特定できない。

### 4.2 想定すべき揺れ

9自治体データが将来提供された際に想定される、さらなる揺れのパターン（未確認だが実装上備えておくべき事項）:

- **BOM付きUTF-8**: 公式仕様は「BOM付きも許容される」と明記している（`Files that include the Unicode byte-order mark (BOM) character are acceptable`）。瑞穂町データはBOM無し（実データで先頭16バイトをバイナリ確認済み、`EF BB BF`は検出されず）だが、他自治体データではBOM付きの可能性がある。パーサはBOMの有無どちらでも正しく列名を解釈できるようにする（CSVパーサライブラリ選定時にBOM除去オプションの有無を確認するか、読み込み時に先頭のBOMシーケンスを明示的に除去する前処理を入れる）。
- **列順の違い**: 公式仕様は列の順序を規定していない（ヘッダー行で定義された名前で解釈するのが原則）。パーサは列順に依存せず、ヘッダー行から列名→インデックスのマッピングを都度構築する実装にする（配列インデックスの固定参照は禁止）。
- **空ファイル・存在しないファイル**: `locations.geojson`が存在しない（瑞穂町の実例）、`booking_rules.txt`が存在しない（予約不要なFlexサービスもありうる）、`location_groups.txt`/`location_group_stops.txt`が存在しない（GeoJSONゾーン型のみのサービスの場合）等、Optionalファイルの欠如は正常系として扱う。ファイルが存在してヘッダー行のみでデータ0行というケースも許容する。
- **改行コードの混在**: 公式仕様は`CRLF`と`LF`の両方を許容している。瑞穂町データはLFのみだが、他自治体はCRLFの可能性がある。
- **CSVエスケープの取り扱い**: `message`列のような自由文フィールドにカンマや引用符が含まれる場合、RFC4180準拠のクオート処理（ダブルクオートで囲み、内部の`"`は`""`にエスケープ）が必要。瑞穂町の`message`列は日本語の読点「、」を含むがカンマ`,`は含まないため今回は問題にならなかったが、他自治体データでは`,`を含む自由文が来る可能性がある。実装では信頼できるCSVパーサライブラリ（例: `csv-parse`, `papaparse`）を使い、独自の`split(",")`によるパースは避ける。
- **全角文字・特殊文字の混在**: 瑞穂町の`stops.txt`には全角英数字（`ＧＲガレージ多摩`のＧ・Ｒ、`トヨタＳ＆Ｄ`のＳ・＆・Ｄ）や全角スペース（`フレッシュランド西多摩　よつ葉の湯`）が停留所名に混在している。文字列の正規化（NFKC等）を行うかどうかは表示用途に応じて判断するが、内部的なID比較には影響しないよう、名寄せ処理では正規化後の文字列は比較用途に限定し、元の表示名は保持する。
- **緯度経度の桁数の不揃い**: 瑞穂町の`stops.txt`では小数点以下5桁（`35.76512`）と6桁（`35.765552`）が混在している。数値としてパースすれば桁数の違いは問題にならないが、文字列としての比較（キャッシュキー等）に使う場合は注意する。
- **feed_versionとファイル名の日付のズレ**: 瑞穂町データはリソース公開日`20260202`とフィード内部の`feed_version=20260215`が異なっていた（既存検分レポート1章）。バージョン管理・差分検出ロジックでは両方を保持し、どちらを版識別の正とするかを明示的に決める。
- **同一データの複数チャネルでの重複公開**: `09_固定路線データ調査.md`が指摘する通り、同一自治体のFlexデータがODPT/CKANとGTFSデータリポジトリの両方に別バージョンで存在する可能性がある。パーサ層の直接の懸念ではないが、データ取り込みパイプライン側で名寄せ（`organization_id + feed_id`）が必要になることを想定し、パーサが受け取るデータには出典チャネルの情報を保持できるようにしておく。

### 4.3 TypeScriptでの型定義方針

**方針: 全列optional＋正規化層**

生のCSV/GeoJSONパース結果は、公式仕様上「必須」とされる列であっても、実データでは欠落している可能性がある（4.1節の実例）。したがって型定義の第一層（Raw層）では全フィールドをoptionalとして受け止め、実行時に検証・補完・デフォルト適用を行う正規化層（Normalized層）を分離する。

```typescript
// --- Raw層: CSVから読み取った直後の型。全列optional、値は文字列のまま ---
interface RawStopTimeRow {
  trip_id?: string;
  stop_id?: string;
  location_group_id?: string;
  location_id?: string;
  stop_sequence?: string;
  arrival_time?: string;
  departure_time?: string;
  start_pickup_drop_off_window?: string;
  end_pickup_drop_off_window?: string;
  pickup_type?: string;
  drop_off_type?: string;
  pickup_booking_rule_id?: string;
  drop_off_booking_rule_id?: string;
  timepoint?: string;
  mean_duration_factor?: string;
  mean_duration_offset?: string;
  safe_duration_factor?: string;
  safe_duration_offset?: string;
  // 未知の列も許容するため、明示的に列挙した以外の列名も受け付ける
  [unknownColumn: string]: string | undefined;
}

// --- Normalized層: 型変換・検証・欠損補完を経た後の型。実装コードはこちらのみを見る ---
type PickupDropOffType = 0 | 1 | 2 | 3;

interface NormalizedStopTimeRow {
  tripId: string;                          // 欠損なら行自体を無効として除外（trip_idは必須中の必須）
  stopSequence: number;                     // 欠損時は行の出現順で補完（フォールバック）
  locationRef:
    | { kind: "stop"; stopId: string }
    | { kind: "locationGroup"; locationGroupId: string }
    | { kind: "location"; locationId: string }
    | { kind: "unresolved" };               // 3種いずれも取れない異常系。ログに警告を出し探索対象からは除外
  arrivalTime?: GtfsTime;                   // 欠損許容。undefinedなら時間窓方式とみなす
  departureTime?: GtfsTime;
  pickupWindow?: { start: GtfsTime; end: GtfsTime }; // start/endが両方揃っていない場合はundefined
  pickupType: PickupDropOffType;            // 欠損時は0（規定運行）にフォールバック。ただし時間窓方式の行で0はDefault不可のため、その場合は1にフォールバック
  dropOffType: PickupDropOffType;
  pickupBookingRuleId?: string;
  dropOffBookingRuleId?: string;
  timepoint?: 0 | 1;
}
```

正規化層への変換関数は、次のようなフォールバックルールを実装する（優先順位順）。

1. `trip_id`が欠損 → 行を破棄し、パース警告ログに記録する（致命的だが例外は投げない。呼び出し元がエラー配列を受け取れる設計にする）。
2. `stop_id`/`location_group_id`/`location_id`が3つとも欠損 → `locationRef: { kind: "unresolved" }`とし、探索グラフには組み込まない（警告ログに記録）。
3. `arrival_time`/`departure_time`と`start/end_pickup_drop_off_window`が両方欠損（瑞穂町のような列自体が無いケース含む） → 時間窓が両方あれば時間窓方式、無ければ「時刻不明」として`timepoint`相当の情報なしで扱う（探索では「常時利用可能」の最も緩い仮定を置くか、行自体を無視するかは実装判断。本仕様では**行を無視せず「終日利用可能（00:00:00-24:00:00相当）」として扱う**ことを推奨。理由: 情報が無いことをもって「利用不可」と判定するのは安全側に倒しすぎて実用性を損なうため）。
4. `pickup_type`/`drop_off_type`が欠損 → 公式仕様のデフォルト値`0`（定時運行の通常乗降）にフォールバックする。ただし当該行が時間窓方式（`start/end_pickup_drop_off_window`が設定されている）の場合、`pickup_type=0`は仕様上禁止されているため、この場合のみ`2`（要予約）にフォールバックする（安全側: 「予約なしで自由に乗れる」という楽観的な解釈より、「予約が要るかもしれない」という慎重な解釈を既定にする）。
5. `booking_rule_id`が指す先の`booking_rules.txt`にレコードが見つからない（外部キー不整合） → 予約制約なしとして扱い、警告ログに記録する。

この正規化層の設計により、実装コード本体（RAPTOR拡張ロジック等）は「欠損があるかもしれない」という条件分岐を一切書かずに済み、`NormalizedStopTimeRow`の型だけを見て安全に処理できる。

### 4.4 ファイル読み込み全体の堅牢性

- 12ファイル（agency, stops, routes, trips, calendar, calendar_dates, location_groups, location_group_stops, stop_times, booking_rules, translations, feed_info）＋GeoJSON（locations.geojson）のうち、Optional指定のファイル（`stops.txt`は`locations.geojson`があれば省略可、`calendar.txt`/`calendar_dates.txt`のいずれかは省略可、`location_groups.txt`/`location_group_stops.txt`/`locations.geojson`/`booking_rules.txt`は全てOptional）が存在しないことを正常系としてハンドルする。ファイルの存在チェックは「読み込み失敗＝空配列として扱う」という単純な規則に統一する。
- ZIPアーカイブの直下にファイルが無く、サブフォルダに入っている場合（仕様違反だが実データでありうる）への耐性は本プロジェクトの優先度としては低いが、ZIP展開処理でトップレベルの検索に加えて1階層のフォールバック探索を入れておくと安全側。
- 文字エンコーディングはUTF-8を既定とし、UTF-8でデコードできない場合（Shift_JIS等での提供、日本の自治体データでは十分あり得る）はフォールバックとしてShift_JIS/CP932としての再デコードを試みるロジックを持つことを推奨する（要確認: 9自治体データで実際にShift_JIS提供があるかは未確認だが、日本国内の行政データでは既知のリスクパターンである）。

---

## 5. テストケース案

瑞穂町データ（`/sessions/compassionate-blissful-turing/mnt/ODPT2026/data/gtfs-flex/mizuho/extracted/`の12ファイル）をフィクスチャとした受け入れテスト項目案。TDD（`08_作業計画_WBS.md`のI-2で言及）の起点として使う。

### 5.1 パーサ単体テスト

1. **T-P01**: 12ファイル全てを読み込み、パースエラーなく完了すること。`locations.geojson`が存在しないことを検出し、警告ログではなく正常系（該当ファイルなしフラグ）として扱われること。
2. **T-P02**: `stop_times.txt`の4行全てが、`arrival_time`/`departure_time`が`undefined`、`start_pickup_drop_off_window="09:00:00"`、`end_pickup_drop_off_window="17:00:00"`として正規化されること。
3. **T-P03**: `stop_times.txt`のstop_sequence=1行（east_trip）が`pickupType=2, dropOffType=1`、stop_sequence=2行が`pickupType=1, dropOffType=2`として正しくパースされ、3.3節の分類ロジックで`pickup_only`/`dropoff_only`と判定されること。
4. **T-P04**: `location_group_stops.txt`の120行から、`mizuhomachi_group`に属する`stop_id`の集合が`{1, 2, ..., 120}`（要素数120、重複なし）として構築されること。
5. **T-P05**: `booking_rules.txt`の`general`ルールが`bookingType=1, priorNoticeDurationMin=30`として正規化され、`priorNoticeLastDay`等の未定義フィールドが`undefined`（エラーではない）として扱われること。
6. **T-P06**: `calendar.txt`から`east_service`が火・金・土、`west_service`が月・水・土として正しく曜日ビットが解釈されること。
7. **T-P07**（寛容性の検証）: `stop_times.txt`の`arrival_time`列を試験的に完全に削除したCSVを入力しても、パーサが例外を投げず、該当行が時間窓方式として正規化されること（4.1節の逸脱パターンをそのまま模したフィクスチャ改変テスト）。
8. **T-P08**（寛容性の検証、BOM）: 同じCSVの先頭にUTF-8 BOM（`EF BB BF`）を付加した改変フィクスチャを入力しても、1列目のヘッダー名（`trip_id`等）が正しく認識されること（BOM文字が列名の先頭に混入しないこと）。
9. **T-P09**（寛容性の検証、空ファイル）: `booking_rules.txt`をヘッダー行のみ（データ0行）にした改変フィクスチャで、`pickup_booking_rule_id="general"`を参照する`stop_times`行があっても、外部キー不整合として警告ログに記録されつつパース自体は継続すること。

### 5.2 ルーティング統合テスト

10. **T-R01（基本ケース、依頼文の具体例）**: 火曜10:00に停留所1（殿ケ谷会館）から停留所14（東砂町）への経路検索を実行すると、`east_trip`（火曜は`east_service`が運行日）のFlexレッグ1本が返り、以下を満たすこと。
    - `windowStart=09:00, windowEnd=17:00`の範囲内であることが確認される。
    - 推定所要時間が3.2節の推定式（Haversine×1.4÷時速22km）で計算され、到着予定時刻が10:00＋推定時間として示される。
    - 予約締切が「09:30（10:00の30分前）」と算出され、探索実行時点（仮に検索時刻を9:00とする）ではまだ締切前のため`feasible: true`となる。
    - 案内文に`booking_rules.txt`の`message`列の内容（電話番号050-2030-2630含む）がそのまま提示される。
11. **T-R02（予約締切切れケース）**: 同じ停留所1→停留所14の検索を、検索実行時刻9:45・希望出発時刻10:00で行うと、`feasible: false`となり、「予約締切(09:30)を過ぎているため利用できません」という案内が返ること（3.4節）。
12. **T-R03（運行日外ケース）**: 木曜（east_service/west_serviceいずれも非運行日）に同じ検索を行うと、Flexレッグが1件も返らず、「本日は運行日ではありません」という案内、または該当する運行日（火・金・土・月・水）を提示する案内が返ること。
13. **T-R04（運休日ケース）**: `calendar_dates.txt`に列挙されている運休日（例: 2024-11-03、`east_service`の`exception_type=2`）の火曜相当日に検索を行うと、通常なら運行日である曜日でも当該日はFlexレッグが除外されること。
14. **T-R05（時間窓外ケース）**: 18:00発の希望で検索すると、`windowEnd=17:00`を超えているためFlexレッグが返らないこと。
15. **T-R06（中間地点無視ルールの検証、2.6節）**: 瑞穂町データには単一グループしかないため本来は発生しないケースだが、テスト用に改変したフィクスチャ（グループが3つに分割され、中間グループを経由しないと到達できないように見えるstop_sequenceの配置）で、中間のFlex時間窓レコードが正しく無視され、直接レッグとして扱われることを検証する。
16. **T-R07（グループ内所要時間の妥当性）**: グループ内の最遠2停留所間（bboxの対角に近い2点）で推定所要時間を計算し、サービス時間帯（8時間）に対して現実的な範囲（1時間未満）に収まることを確認する（3.2節の推定式のサニティチェック）。
17. **T-R08（固定路線との統合、乗換ノード近接判定）**: 瑞穂町Flex停留所のいずれかと、別途用意する固定路線バス停留所（ダミーフィクスチャ）が緯度経度で300m以内にある場合、乗換候補として検出されること（3.5節のtransfer扱い）。

### 5.3 データ健全性テスト（バリデーション系）

18. **T-V01**: 全stop_times行の`pickup_type`/`drop_off_type`が、時間窓方式の行で`pickup_type∈{1,2,3}`かつ`drop_off_type∈{1,2,3}`（`0`が含まれていない）ことを検証する（2.5.1節の制約チェック）。
19. **T-V02**: `location_group_stops.txt`の全120`stop_id`が、`stops.txt`に実在する`stop_id`と1対1で対応することを検証する（外部キー整合性）。
20. **T-V03**: `booking_rules.txt`の`booking_type=1`の行に`prior_notice_duration_min`が必ず存在することを検証する（存在しない場合は警告、パース自体は継続、2.4.1節の必須ルール）。

---

## 6. 参考文献リスト

以下はいずれも`mcp__workspace__web_fetch`にて取得（bashでのURL取得は環境制限のため不使用）。取得日は全て2026-07-02。

1. **GTFS Schedule Reference（公式リファレンス本体）**
   https://gtfs.org/documentation/schedule/reference/
   取得日: 2026-07-02
   用途: Dataset Filesテーブル全体、`stop_times.txt`のFlex拡張列定義（`start/end_pickup_drop_off_window`, `pickup_type`, `drop_off_type`, `pickup/drop_off_booking_rule_id`等）、On-demand Service Routing Behavior（中間地点無視ルール・ゾーン重複禁止ルール）の一次確認元。ページが長大なため、`mcp__workspace__web_fetch`の出力上限により`fare_transfer_rules.txt`セクション以降（`areas.txt`〜`attributions.txt`）は本ツールでは全文を取得できず、該当部分は他の参考文献（2, 4, 5, 6）で補完した。

2. **GTFS-Flex Community Extension Page**
   https://gtfs.org/community/extensions/flex/
   取得日: 2026-07-02
   用途: GTFS-Flexの開発史（2013年原案〜2024年3月正式採択）、4種のサービス形態の定義文（Dial-a-ride, Route deviation, Point-to-zone, Point deviation/checkpoint）の一次確認元。

3. **Demand responsive services（データ例ページ）**
   https://gtfs.org/documentation/schedule/examples/flex/
   取得日: 2026-07-02
   用途: 4つの実例パターン（単一ゾーン内オンデマンド、複数ゾーン間オンデマンド、location_group型固定停留所間オンデマンド、route deviation）の具体的なCSV/GeoJSONサンプルデータ。On-demand Service Routing Behaviorの「中間地点無視」「ゾーン重複禁止」の具体例（forbidden/allowedの3パターン）の一次確認元。

4. **Flexible services（機能ガイドページ）**
   https://gtfs.org/getting-started/features/flexible-services/
   取得日: 2026-07-02
   用途: Continuous Stops、Booking Rules、Predefined Routes with Deviation、Zone-Based Demand Responsive Services、Fixed-Stops Demand Responsive Servicesという5機能の分類と、各機能が使うファイル・列の一覧表。`location_groups.txt`/`location_group_stops.txt`の列名（`location_group_id`, `location_group_name`, `stop_id`）、`booking_rules.txt`の全列名一覧の確認元。

5. **MobilityData GTFS-Flex Proposal（原提案文書、GitHub raw）**
   https://raw.githubusercontent.com/MobilityData/gtfs-flex/master/spec/reference.md
   取得日: 2026-07-02
   用途: 正式採択の元となった原提案文書。`booking_rules.txt`の全列の型・Presence・説明文（`booking_type`のEnum値0/1/2の正確な意味、`prior_notice_*`列群の組み合わせルール）、`locations.geojson`のGeoJSON構造の詳細（`RFC 7946`準拠、`Polygon`/`MultiPolygon`制約、`properties`のフィールド一覧）を一字一句確認する一次資料として使用。注記: この文書は`stop_areas.txt`拡張という、最終的に正式採択されなかった代替設計（`location_groups.txt`/`location_group_stops.txt`ではなく既存Fares V2の`stop_areas.txt`を拡張する案）を含んでいるため、エリアグルーピングの「ファイル名・実装方式」についてはこの文書ではなく参考文献1・4を優先した。`booking_rules.txt`と`locations.geojson`の列定義自体は、参考文献4で確認した列名一覧と完全一致するため、正式採択後も変更されていないと判断した。

6. **Google/transit reference.md（raw、GitHub）**
   https://raw.githubusercontent.com/google/transit/master/gtfs/spec/en/reference.md
   取得日: 2026-07-02
   用途: 参考文献1と同一内容のMarkdown原本。`agency.txt`〜`calendar_dates.txt`までのセクション、Document Conventions（Presence用語の定義: Required/Optional/Conditionally Required/Conditionally Forbidden/Recommended）の確認に使用。このファイルも出力上限により`transfers.txt`セクション付近で取得が途切れたため、後半セクションは参考文献1・4・5で補完した。

7. **瑞穂町「チョイソコみずほまち」GTFS-Flexデータ検分**（既存社内ドキュメント）
   `/sessions/compassionate-blissful-turing/mnt/ODPT2026/docs/07_瑞穂町Flexデータ検分.md`
   用途: 瑞穂町実データの構造・特筆事項・仕様逸脱の既存分析。本書の4.1節はこのレポートの4〜6章の内容を実データで再確認した上で要約。

8. **瑞穂町GTFS-Flex実データ本体**
   `/sessions/compassionate-blissful-turing/mnt/ODPT2026/data/gtfs-flex/mizuho/extracted/`（agency.txt, booking_rules.txt, calendar.txt, calendar_dates.txt, feed_info.txt, location_group_stops.txt, location_groups.txt, routes.txt, stop_times.txt, stops.txt, translations.txt, trips.txtの12ファイル）
   用途: 本書全体の「瑞穂町での実値」列・実データ再現の直接の一次資料。BOM有無はバイナリレベル（`od -An -tx1`相当）で確認済み（全12ファイルBOM無し）。

9. **09_固定路線データ調査.md**（既存社内ドキュメント）
   `/sessions/compassionate-blissful-turing/mnt/ODPT2026/docs/09_固定路線データ調査.md`
   用途: 3.5節（固定路線RAPTORへの統合）における「固定路線＝従来型RAPTOR」「Flex＝別レイヤの特殊パーサ」というレイヤ分離方針、箱根ケ崎駅の乗換ノード制約（鉄道側時刻表データ未確保）の参照元。

10. **08_作業計画_WBS.md**（既存社内ドキュメント）
    `/sessions/compassionate-blissful-turing/mnt/ODPT2026/docs/08_作業計画_WBS.md`
    用途: 本書と`13_ルーティングエンジン設計.md`との役割分担（パーサ仕様 vs RAPTORアルゴリズム全体設計）の位置づけ確認。

### 要確認事項一覧（本文中で個別に明記した項目の集約）

- `location_groups.txt`/`location_group_stops.txt`各列の正式なConditionally Required等の詳細条件文言（列名・役割・Primary keyは複数の一次資料で確認済みで信頼性は高いが、gtfs.org公式ページの当該セクションが`web_fetch`の出力上限により直接確認できなかったため、細かいPresence条件のみ要確認）。
- `translations.txt`, `feed_info.txt`, `attributions.txt`の正式なフィールド定義（Flex固有ではないため本書では扱いを最小限にしたが、`web_fetch`でも該当セクションに到達できなかった）。
- 9自治体の実際のチャレンジ限定データにおいて、location_group型以外（GeoJSONゾーン型、複数グループ分割等）が実際に混在するかどうか（未入手のため未確認、パーサは3パターン全対応を前提に設計）。
- 瑞穂町east_trip/west_tripの地理的な区別が実在するか（データ上は確認不能。既存検分レポート7章が提言する「町公式サイトでの確認」は本書執筆時点で未実施）。
- デマンド交通の「予約確定後、実際に車両が来るまでの待機時間」の情報源（3.5節で楽観的仮定を置いたが、実データ・実運用ヒアリングでの裏付けは未実施）。
- 日本の自治体データにおけるShift_JIS等の非UTF-8エンコーディングでの提供可能性（瑞穂町では確認されなかったが、他自治体での実例は未確認）。
