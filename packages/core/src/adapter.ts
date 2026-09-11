export interface InstFetchApplication {
  fetch(request: Request): Response | Promise<Response>;
}

export interface InstAdapter<TOptions, TServer> {
  serve(app: InstFetchApplication, options: TOptions): Promise<TServer>;
}
