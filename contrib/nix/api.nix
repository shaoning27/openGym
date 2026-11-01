{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  importNpmLock,
  version,
}:

buildNpmPackage rec {
  pname = "opengym-api";
  inherit version;

  src = ./../../api;

  nodejs = nodejs_22;

  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/opengym-api
    cp -r node_modules $out/lib/opengym-api/
    cp -r coach $out/lib/opengym-api/
    # Every top-level module server.ts imports: server.ts, password.ts, passkeys-store.ts,
    # rate-limit.ts, media.ts, device-link.ts, push-messages.ts, verify-error.js. Copy the
    # glob rather than an explicit list — a hand-kept list silently ships an incomplete tree
    # and the failure only shows up as ERR_MODULE_NOT_FOUND in the systemd journal.
    cp ./*.js ./*.ts $out/lib/opengym-api/

    mkdir -p $out/bin
    makeWrapper ${nodejs_22}/bin/node $out/bin/opengym-api \
      --add-flags "$out/lib/opengym-api/server.ts" \
      --set NODE_ENV production
    runHook postInstall
  '';

  meta = with lib; {
    description = "openGym API — passkey auth + per-user workout data (Node.js)";
    homepage = "https://gitlab.com/DuarteSantos8/opengym";
    license = licenses.agpl3Plus;
    platforms = nodejs.meta.platforms;
  };
}
