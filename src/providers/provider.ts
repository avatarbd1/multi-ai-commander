export interface CapturedProviderOutput<T> {
  provider: string;
  capturedAt: string;
  payload: T;
  sourceReference?: string;
}

export interface ReviewProvider<TInput, TOutput> {
  readonly name: string;
  review(input: TInput): Promise<CapturedProviderOutput<TOutput>>;
}
