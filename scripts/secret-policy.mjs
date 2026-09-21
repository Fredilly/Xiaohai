export function secretFile(path) {
  return (
    (/(^|\/)\.env($|\.)/.test(path) && !path.endsWith('.example')) ||
    path.endsWith('project.private.config.json') ||
    /\.(pem|key|p12|pfx)$/i.test(path)
  );
}

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  new RegExp('gh[pousr]_[A-Za-z0-9]{36,}'),
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  new RegExp('-----BEGIN ' + 'CERTIFICATE-----[\\s\\S]+?-----END CERTIFICATE-----'),
];
export function containsSecret(content) {
  return patterns.some((pattern) => pattern.test(content));
}
