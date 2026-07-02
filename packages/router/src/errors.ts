// 分類済みエラー型。闇雲なthrowを避け、入力起因のエラーを型で区別する。
export class RouterInputError extends Error {
  readonly code = "INVALID_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "RouterInputError";
  }
}
