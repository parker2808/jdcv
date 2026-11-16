export class PrivateCvError extends Error {
  constructor(
    readonly code:
      | 'CV_SOURCE_MISSING'
      | 'CV_SOURCE_AMBIGUOUS'
      | 'CV_SOURCE_UNSAFE'
      | 'CV_SOURCE_UNSUPPORTED'
      | 'CV_SOURCE_CONFIG'
      | 'CV_SOURCE_HTTP'
      | 'CV_SOURCE_NETWORK'
      | 'CV_SOURCE_TIMEOUT'
      | 'CV_SOURCE_SCHEMA'
      | 'CV_SOURCE_EMPTY',
  ) {
    super(code);
  }
}
