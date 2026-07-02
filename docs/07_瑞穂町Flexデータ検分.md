# 瑞穂町「チョイソコみずほまち」GTFS-Flexデータ検分

**状態: 完了（実データ検分済み）**

前回はネットワーク制限によりZIP本体を取得できなかったが、今回はユーザーが手動で
ダウンロードしたZIPファイルがローカルに格納されており、これを展開・検分した。
本ドキュメントは実データの内容に基づいて全面的に書き直したものである。

---

## 1. データ概要

| 項目 | 内容 |
|---|---|
| 出典 | https://ckan.odpt.org/dataset/mizuho_town_mizuho_area |
| データセット名 | 瑞穂町デマンド交通「チョイソコみずほまち」 |
| ライセンス | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| データバージョン | 20260202 |
| ファイル名 | `Mizuho_Area-20260202.zip`（7,096 バイト） |
| ZIP展開後合計サイズ | 17,867 バイト（12ファイル） |
| 取得日 | 2026-07-02 |
| 取得方法 | ネットワーク制限のため、ユーザーが手動でダウンロードし作業フォルダに格納したものを使用（本作業ではネットワークアクセスは行っていない） |
| 格納パス | `/sessions/compassionate-blissful-turing/mnt/ODPT2026/data/gtfs-flex/mizuho/Mizuho_Area-20260202.zip` |
| 文字コード | UTF-8（BOMなし、全ファイル共通） |
| 改行コード | LF（全ファイル共通、CRLFなし） |
| フィード有効期間（`feed_info.txt`） | 2024-10-01 〜 2026-09-30 |
| フィードバージョン表記（`feed_info.txt`内`feed_version`） | 20260215 |

注記: リソースの版表記は`20260202`だが、フィード内部の`feed_version`列は`20260215`となっており、
ファイル名の日付とフィード内部バージョンの間に**ズレ**が存在する。実運用ではこの手のズレは
ODPT側の更新プロセスに起因することが多く、実装上は「ファイル名の日付」と「feed_info内の日付」を
両方保持し、どちらを版識別に使うかをパーサ側で明示的に決めておくべきである。

---

## 2. ファイル構成一覧

展開すると`locations.geojson`は含まれておらず、以下の12ファイルのみで構成される
（事前情報どおり）。全ファイルとも1トリップ・1サービス・1グループという極めて小規模な構成。

| ファイル名 | データ行数（ヘッダ除く） | 主要列 | 役割 |
|---|---|---|---|
| `agency.txt` | 1 | agency_id, agency_name, agency_url, agency_timezone, agency_lang, agency_phone | 事業者情報（瑞穂町、電話050-2030-2630） |
| `feed_info.txt` | 1 | feed_publisher_name, feed_lang, feed_start_date, feed_end_date, feed_version, feed_contact_email | フィード全体のメタ情報 |
| `routes.txt` | 1 | route_id, route_short_name, route_long_name, route_type, route_desc | 路線定義（route_type=715） |
| `trips.txt` | 2 | route_id, service_id, trip_id, trip_headsign, direction_id | トリップ定義（east/west 2本のみ） |
| `calendar.txt` | 2 | service_id, 曜日7列, start_date, end_date | 曜日パターン定義（east/west） |
| `calendar_dates.txt` | 96 | service_id, date, exception_type | 祝日・年末年始等の運休日（すべてexception_type=2） |
| `stops.txt` | 120 | stop_id, stop_name, stop_lat, stop_lon, location_type | 停留所（すべてlocation_type=0） |
| `location_groups.txt` | 1 | location_group_id, location_group_name | 乗降グループ定義（グループは1つのみ） |
| `location_group_stops.txt` | 120 | location_group_id, stop_id | グループへの停留所の割り当て（全120停留所） |
| `stop_times.txt` | 4 | trip_id, location_group_id, stop_sequence, start/end_pickup_drop_off_window, pickup_type, drop_off_type, pickup/drop_off_booking_rule_id, timepoint | Flex時間窓と乗降制約の中核 |
| `booking_rules.txt` | 1 | booking_rule_id, booking_type, prior_notice_duration_min, message, phone_number, info_url, booking_url | 予約ルール定義（ルールは1種類のみ） |
| `translations.txt` | 127 | table_name, field_name, language, translation, record_id | 英語翻訳（ローマ字転写） |

**参照関係の要点**: `stops.txt`の120件は個別には`stop_times.txt`から直接参照されない。
`location_group_stops.txt`によって全120件が単一の`location_group_id = mizuhomachi_group`に
紐づけられ、`stop_times.txt`はこの`location_group_id`のみを参照する。つまり実質的には
「町内全120停留所のどこでも乗降可能な1つの巨大グループ」として運行がモデル化されている。

---

## 3. 運行モデルの解説

### 3.1 路線・トリップ

`routes.txt`は1路線のみ:

```
route_id=mizuhomachi_route, route_short_name=瑞穂町デマンド,
route_long_name=チョイソコみずほまち, route_type=715,
route_desc=瑞穂町チョイソコみずほまちデマンドサービス
```

`route_type=715`はGTFS拡張route type（Extended Route Types）の
`700`番台（Bus Service）系列に属し、`715`は**Demand and Response Bus Service**
（デマンド応答型バスサービス）を表す値である。値自体は拡張仕様に沿った適切な選択。

`trips.txt`にはトリップが2本のみ存在し、east/west の2エリアサービスに対応する:

```
east_trip: route=mizuhomachi_route, service=east_service, headsign=瑞穂町全域
west_trip: route=mizuhomachi_route, service=west_service, headsign=瑞穂町全域
```

`trip_headsign`はどちらも「瑞穂町全域」で、方向・地域による便の区別が名称からは
分からない（内部的にはservice_idの曜日パターンでのみ区別される）。

### 3.2 運行曜日（calendar.txt）

| service_id | 運行曜日 | 運行期間 |
|---|---|---|
| east_service | 火・金・土 | 2024-10-01 〜 2026-09-30 |
| west_service | 月・水・土 | 2024-10-01 〜 2026-09-30 |

土曜日はeast/west両方が運行対象となる唯一の重複日である。つまり平日は
「火・金＝東エリア扱い」「月・水＝西エリア扱い」に分かれ、木・日は完全に運休、
土曜のみ両方の便が有効になる週間パターン。ここでの「east」「west」は
trip_headsignやstopデータからは地理的な東西分割の実態を確認できず
（stopsはlocation_group経由で全120件が両tripから等しく参照可能な構造になっている）、
命名上の便宜的な区別である可能性が高い。**実際に東西で乗降可能な停留所セットが
分かれているのではなく、両トリップとも同一の`mizuhomachi_group`（全120停留所）を
参照している点は実装上重要**（4.3節で詳述）。

### 3.3 運休日（calendar_dates.txt）

全96行、すべて`exception_type=2`（運休）。east_service用48件・west_service用48件が
完全に同一の日付パターンで設定されている。2024年10月14日（体育の日）から
2026年9月23日（秋分の日）まで、祝日・振替休日・年末年始（12/29-1/3）・GW・お盆等、
日本の祝祭日カレンダーに沿った運休日が機械的にほぼ全て列挙されている。

### 3.4 サービス提供時間帯・乗降ウィンドウ

`stop_times.txt`の4行は以下の通り（east/west共通のパターン）:

| trip_id | stop_sequence | window開始 | window終了 | pickup_type | drop_off_type | 予約ルール |
|---|---|---|---|---|---|---|
| east_trip | 1 | 09:00:00 | 17:00:00 | 2（要予約） | 1（降車不可） | pickup: general |
| east_trip | 2 | 09:00:00 | 17:00:00 | 1（乗車不可） | 2（要予約） | drop_off: general |
| west_trip | 1 | 09:00:00 | 17:00:00 | 2（要予約） | 1（降車不可） | pickup: general |
| west_trip | 2 | 09:00:00 | 17:00:00 | 1（乗車不可） | 2（要予約） | drop_off: general |

サービス提供時間は**9:00〜17:00の1つの時間窓のみ**で、1トリップにつき
「乗車専用の疑似停留所行（stop_sequence=1）」と「降車専用の疑似停留所行
（stop_sequence=2）」の2行に分かれている。これはGTFS-Flexで「同じ時間窓の中で
どこでも乗って、どこでも降りられる」ことを表現する一般的なパターンで、
実質的には**「1日1本の時間窓（9-17時）の中に、予約が入った順に乗降が発生する」
という運行像**になっている。個別の発車時刻（например 9:00発、10:00発...のような
複数便のタイムテーブル）は存在せず、GTFSの従来的な「便」概念とは異なる、
時間窓ベースの単一の応答サービスとして表現されている。

重要な技術的事実: **`stop_times.txt`には`arrival_time`/`departure_time`列自体が
存在しない**（列構成は`trip_id, location_group_id, stop_sequence,
start_pickup_drop_off_window, end_pickup_drop_off_window, pickup_type,
drop_off_type, pickup_booking_rule_id, drop_off_booking_rule_id, timepoint`の
10列のみ）。GTFS-Flex v2仕様では固定時刻列とpickup/drop_off windowを
併用するテーブル構造が想定されており、window方式の行では両時刻列を**空文字として
残す**運用が一般的だが、本データはそもそも列自体を定義していない。多くのGTFS-Flex
バリデータは「必須ではないが推奨される列の欠落」として警告を出す可能性がある
（6章で詳述）。

`timepoint=1`（正確な時刻）が設定されているが、対応する固定時刻自体が
存在しないため、この値の実質的な意味は薄い。

### 3.5 エリア構造（ゾーン型か停留所型か）

`locations.geojson`が存在しないため、自由な多角形ゾーン内乗降ではなく、
**明示的な120箇所の停留所（location_type=0）を束ねた「停留所グループ」方式**で
エリアをモデル化している。これはGTFS-Flex v2の2つの代替手法
（`locations.geojson`によるポリゴンゾーン vs `location_groups.txt`+
`location_group_stops.txt`による停留所グルーピング）のうち後者を採用したもので、
実運用上は「町内120か所のいずれかの停留所から乗って、いずれかの停留所で降りる」
という、事前定義された地点間の自由な組み合わせサービスとなる。

停留所は町内に幅広く分布しており（後述bbox参照）、公民館・医療機関・金融機関・
公園・住宅地の集会所など、地域の生活拠点をカバーする命名になっている
（例: 殿ケ谷会館、菜の花クリニック、瑞穂病院、瑞穂町役場、各種信用金庫支店等）。

停留所座標のbbox: 緯度 35.74723 〜 35.79363、経度 139.32490 〜 139.36645
（瑞穂町の行政区域内に収まる範囲）。全120stop_idに重複する停留所名はなく、
`location_type`はすべて`0`（stop/platform、親子関係なし）。

---

## 4. 予約ルール詳細（利用者向け案内用）

`booking_rules.txt`にはルールが1件のみ定義されている（`booking_rule_id = general`）。
このルールが全乗車・全降車で共通して使われる。

| 項目 | 値 |
|---|---|
| ルールID | general |
| booking_type | 1（当日事前予約：同日中の締切） |
| 事前予約締切 | 利用の**30分前**まで（`prior_notice_duration_min=30`） |
| 案内文（message列そのまま） | 「ご利用の30分前までに予約が必要で、電話予約は8:30から16:30まで、オンライン予約は24時間受付」 |
| 電話番号 | 050-2030-2630 |
| 案内URL | https://www.town.mizuho.tokyo.jp/ |
| 予約用URL（booking_url） | 未設定（空欄） |

利用者向けにそのまま案内できる形にまとめると:

> **チョイソコみずほまちのご利用には事前予約が必要です。**
> - 運行時間: 9:00〜17:00
> - 運行日: 火・金・土（東エリア）／月・水・土（西エリア）※木・日は運休
> - 予約締切: ご利用の**30分前**まで
> - 電話予約受付時間: **8:30〜16:30**
> - オンライン予約: **24時間受付**（ただし本データにはオンライン予約用URLの記載なし。予約手段の詳細は上記案内URL先を要確認）
> - 予約・お問い合わせ: 050-2030-2630

**データ上の技術的な注意点**: `booking_type=1`（当日事前予約）に対して、
GTFS-Flex v2で通常併用される`prior_notice_last_day`（前日以前の締切日オフセット）や
`prior_notice_last_time`（当日締切の具体的時刻）の列自体が定義されていない。
「30分前まで」という締切ルールは`prior_notice_duration_min=30`のみで表現されており、
これは仕様として正しい最小構成だが、「電話予約は8:30-16:30まで」という
より詳細な受付時間の制約は構造化列ではなく**message列の自由文のみ**に
埋め込まれている。パーサが構造化データとしてこの受付時間帯を扱いたい場合、
本データからは機械的に抽出できず、自由文解析または別途のハードコード対応が必要になる。

---

## 5. 経路検索エンジン実装への示唆

### 5.1 パーサ要件

- **標準GTFSパーサの拡張が必須**: `stop_times.txt`が`arrival_time`/
  `departure_time`を持たず、代わりに`location_group_id`,
  `start_pickup_drop_off_window`, `end_pickup_drop_off_window`,
  `pickup_booking_rule_id`, `drop_off_booking_rule_id`という
  GTFS-Flex拡張列を主体に構成されている。既存の固定時刻ベースGTFSパーサを
  流用する場合、これらの列が欠落していても例外を投げず、時間窓ベースの
  行として正しく解釈できるようにする必要がある。
- **`stop_id`ではなく`location_group_id`をキーに**乗降可能地点を解決する経路を
  用意する。本データでは`stop_times`行に`stop_id`が一切登場せず、必ず
  `location_group_stops.txt`経由の展開が必要になる。
- `booking_rules.txt`の`booking_rule_id`を`pickup_booking_rule_id` /
  `drop_off_booking_rule_id`から解決し、`booking_type`・
  `prior_notice_duration_min`を探索ロジックに渡す構造にする。

### 5.2 location_group展開の扱い

`location_group_stops.txt`によって`mizuhomachi_group`が120停留所すべてに
展開される。実装上は以下のいずれかの方針が考えられる。

1. **展開して個別stopとして扱う**: グループを120個の個別ノードに展開し、
   「グループ内の任意の2点間で乗降可能」という制約（同一trip内の
   pickup行・drop_off行のペアから来る）をエッジ生成時に適用する。
   停留所間の徒歩距離や道路距離を使わず、グループ内は「Flexサービスで
   直接移動可能」という1本の疑似エッジ（大きな移動コストを持つ）として
   経路探索グラフに組み込むのが自然。
2. **グループをまるごと1ノードとして扱い、後段で最寄り停留所へのマッピングを行う**:
   検索結果として「グループ内のどこから乗ってどこで降りるか」をユーザー入力
   （出発地・目的地の緯度経度）から動的に決定する。この場合、120停留所への
   最近傍検索（kd-tree等）が別途必要になる。

今回のデータは**1グループに全停留所が属する**という最も単純なケースであり、
複数グループが混在する（例: 東側グループ・西側グループに分割されている）
将来的なデータにも耐えるよう、グループ単位の展開ロジックは汎用化しておくべき。
なお、east_trip/west_tripの2トリップは曜日で区別されるだけで、
参照している`location_group_id`は両方とも同一の`mizuhomachi_group`である点に注意
（東西で乗降可能エリアが分かれているわけではない）。

### 5.3 時間窓×予約締切の探索への組み込み

- 出発時刻（あるいは希望到着時刻）が`start_pickup_drop_off_window`〜
  `end_pickup_drop_off_window`（本データでは常に09:00-17:00）に
  収まっているかをまず判定する。
- 収まっている場合、「現在時刻＋`prior_notice_duration_min`分」が
  希望乗車時刻以前であるかを判定条件として追加する（本データでは30分）。
  これを満たさない場合、その時間帯の利用は不可として探索結果から除外、
  または「予約締切に間に合わない」旨をユーザーに明示する。
- `booking_type=1`（当日事前予約）の場合、締切は当日中の相対時間
  （分単位）で表現されるため、日付をまたぐ判定は不要。将来的に
  `booking_type=2`（前日以前予約）のデータが混在するケースに備えて、
  `prior_notice_last_day`・`prior_notice_start_day`等の絶対日オフセット
  列も解釈できる設計にしておくと拡張性が高い。
- 電話予約受付時間（8:30-16:30）はmessage列の自由文にしかないため、
  これを探索の枝刈り条件として使いたい場合は、瑞穂町固有の設定値として
  別途ハードコードするか、運営側に構造化データでの提供を促す必要がある
  （汎用パーサではこの制約を自動抽出できない）。

### 5.4 固定路線GTFSとの統合方法

- `route_type=715`（Demand and Response Bus Service）で判定し、
  固定路線バス（route_type=3など）と異なる探索ロジック（時間窓＋予約締切）に
  振り分けるルーティングレイヤを用意する。
- 乗換ノードとしては、Flex側の120停留所のうち、固定路線バスの停留所と
  地理的に近接するものを乗換候補として自動検出する（本データにはバス停との
  相互参照列はないため、緯度経度ベースの近接判定が必要）。
- 探索アルゴリズム全体としては、固定時刻の経路探索（例: RAPTOR系）に対して
  Flexセグメントを「特殊なエッジ」として組み込み、そのエッジのコストに
  window内での待ち時間＋予約締切による実質遅延を加味する設計が妥当。

---

## 6. データの癖・注意点

- **`stop_times.txt`に`arrival_time`/`departure_time`列が存在しない**:
  GTFS-Flex v2仕様は多くの実装で「列は残し値を空にする」運用を採る一方、
  本データは列自体を省略している。GTFS検証ツール（Googleの`gtfs-validator`や
  MobilityDataのvalidatorなど）は、必須ではないがベストプラクティスとして
  推奨される列の欠落や、時間窓のみのstop_times行に対する警告を出すことがある。
  CKANページ上の「GTFS検証結果: エラーあり」バッジは、この列欠落、または
  下記の`booking_rules`列不足に起因する可能性が高いと推測される
  （検証結果ページ自体は本タスクのネットワーク制約により未確認、推定に留まる）。
- **`booking_rules.txt`に`prior_notice_last_day`/`prior_notice_last_time`等の
  詳細締切列がない**: `booking_type=1`との組み合わせで本来推奨される
  補助列が未設定。「電話予約は8:30-16:30まで」という制約が構造化されておらず、
  自由文（message列）のみに存在する。これも検証エラーの一因になり得る。
- **east/west 2サービスの地理的区別が実データからは確認できない**:
  `trip_headsign`はどちらも「瑞穂町全域」、参照する`location_group_id`も
  同一。曜日パターン（火金土 vs 月水土）以外に東西で区別する情報がなく、
  運行主体側が地域を分けて配車していても、データ上はそれが表現されていない
  （あるいは実際には地域分割がなく、単に曜日別の便数管理のためだけに
  2サービスIDを使っている可能性もある）。経路探索エンジンが「東エリア」
  「西エリア」という区分をユーザーに提示する場合、このデータだけでは
  地理的な境界を再構築できない点に注意。
- **`translations.txt`の停留所名はローマ字転写のみ**: 例えば「殿ケ谷会館」は
  `Tonogayakaikan`、「多世代交流センターMIZCUL」は
  `Tasedaikouryuusentaamizukaru`のように、意味的な英訳ではなく機械的な
  ローマ字化になっている（施設名の固有名詞部分も含めて全てローマ字化されており、
  英語ネイティブにとっての可読性・意味理解には限界がある）。UI表示用に
  英語対応を行う場合、この翻訳をそのまま使うか、施設種別の意訳を別途用意するかの
  判断が必要。
- **予約URL（`booking_url`）が空**: message列では「オンライン予約は24時間受付」と
  案内されているにもかかわらず、`booking_rules.txt`の`booking_url`列は空欄。
  オンライン予約の実際の窓口（Webサイト内のどのページか、専用アプリか等）は
  このデータからは特定できない。
- **calendar_dates.txtの運休日はほぼ機械的な祝日リスト**: east/west
  両サービスに完全に同一の48日×2＝96行が設定されており、個別のイレギュラー
  運休（車両点検等）ではなく祝祭日カレンダーの一括適用と見られる。将来の
  データ更新では、祝日カレンダーの年次更新（2027年以降の祝日追加）が
  行われるかどうかを監視する必要がある。
- **1トリップあたり2行という省略的なstop_times構成**: 通常の固定時刻GTFSでは
  停車パターンごとに複数のstop_sequence行が並ぶが、本データはpickup専用行・
  drop_off専用行のペアのみで「町内どこでも」を表現する非常にミニマルな構成。
  今後停留所グループが複数に分割される、あるいは時間帯が複数の窓に分かれる
  改修が行われた場合、この2行パターンを前提にしたパーサ実装は容易に破綻する
  ため、行数・組み合わせを固定長で仮定しないこと。

---

## 7. 次のステップ

1. **GTFS検証結果ページの確認**: members-portal.odpt.org
   （またはCKANリソースページからリンクされる検証結果）にアクセスし、
   「エラーあり」の具体的な内容を確認する。本レポート6章の推測
   （`arrival_time`/`departure_time`列欠落、`booking_rules`補助列不足）が
   実際のエラー内容と一致するかを検証する。ネットワークアクセスが可能な
   タイミングで実施。
2. **他のGTFS-Flex提供事業者データとの比較**: ODPTには他にもデマンド交通の
   GTFS-Flexデータが公開されている可能性がある。複数事業者のデータを
   比較し、`location_groups`方式と`locations.geojson`方式のどちらが
   主流か、booking_rulesの構造化がどの程度なされているかを確認して
   パーサの汎用性を検証する。
3. **固定路線GTFS（瑞穂町周辺のバス路線）との統合検証**: 実際に瑞穂町
   周辺を走る西武バス等の固定路線GTFSを入手し、Flexデータの停留所群と
   地理的にどう関係するか（乗換候補になり得る停留所の特定）を確認する。
4. **パーサのプロトタイプ実装**: 本データを最小のテストケースとして、
   `location_group`展開・時間窓判定・予約締切判定を行う経路探索エンジンの
   コアロジックを試作する。1グループ・1時間窓・1予約ルールという
   最小構成のため、単体テストのフィクスチャとして適している。
5. **東西エリア分割の実態確認**: 瑞穂町または運行事業者（アイシン系の
   「チョイソコ」ブランド事業）への問い合わせ、または町公式サイトの
   デマンド交通案内ページを確認し、east/westサービスが実際に地理的な
   区分を持つのか、単純な曜日別運用なのかを確認する。
