# qrcode-generator

Vendored from [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator/tree/js2.0.4), `js/dist/qrcode.mjs`, renamed to `.js` for the app's existing static module serving. The source is otherwise unchanged.

Copyright (c) 2009 Kazuhiko Arase. Distributed under the MIT license; see `qrcode-generator.LICENSE`.

Used only to encode the authenticator provisioning URI inside the browser. No third-party service receives the URI or secret, and no runtime package installation or CDN is required.
