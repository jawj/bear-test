
This proof-of-concept project uses BearSSL to tunnel TLS 1.2 over WebSockets from browsers (and, soon, other JS engines without TCP sockets). It currently supports Let's Encrypt certificates only, since it embeds only the [ISRG Root X1 trust root](https://letsencrypt.org/certs/isrgrootx1.pem).

Note that there is plenty of low-hanging tidying and optimising still to be done (e.g. we're calling `setValue` and `getValue` in loops rather thsn moving memory around in bigger chunks).

## Dependencies

You need emscripten. You also need to be running the `ws2s` server to provide the tunnelling:

```
python3 -m venv ws2s
cd ws2s
source bin/activate
pip install ws2s-python --upgrade
ws2sd run
```

If you need to change any settings, such as the WebSocket port, these are in `~/.ws2s/config.json`.

Note: other tunneling libraries are available, but have not been evaluated.

## Build

In a directory adjacent to this one, get the BearSSL source tree: `git clone https://www.bearssl.org/git/BearSSL`.

Then, back in this directory:

```bash
emcc jstlsclient.c $(find ../BearSSL/src -name \*.c) \
  -I../BearSSL/inc -I../BearSSL/src \
  -o bearssl.js \
  -sEXPORTED_FUNCTIONS=_initTls,_writeData,_readData \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,setValue \
  -sASYNCIFY \
  --post-js post-run.js
```

For production, we'll want to add `-O3` to the `emcc` command above.

## Run

Start a local server in this directory, then navigate to it, adding a host and (optional) port — e.g. `http://localhost:8080/?neon.tech`.

## Test

You can test against the various [BadSSL hosts](https://badssl.com/) — e.g. `http://localhost:8080/?wrong.host.badssl.com` or `http://localhost:8080/?tls-v1-0.badssl.com:1010` (this will fail as we're configured to accept only TLS 1.2).

To interpret the resulting error codes, see:

https://bearssl.org/apidoc/bearssl__ssl_8h.html
https://bearssl.org/apidoc/bearssl__x509_8h.html
