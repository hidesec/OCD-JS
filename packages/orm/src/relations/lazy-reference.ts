export class LazyReference<T> implements PromiseLike<T> {
  private resolved?: T;
  private loading?: Promise<T>;

  constructor(private readonly loader: () => Promise<T>) {}

  async load(): Promise<T> {
    if (this.resolved !== undefined) {
      return this.resolved;
    }
    if (!this.loading) {
      this.loading = this.loader().then((value) => {
        this.resolved = value;
        return value;
      });
    }
    return this.loading;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.load().then(onfulfilled, onrejected);
  }
}
