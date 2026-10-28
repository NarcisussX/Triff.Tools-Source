const Module = require("module");

let installed = false;

function middleware() {
  return (_req, _res, next) => {
    if (typeof next === "function") next();
  };
}

function routerStub() {
  const router = middleware();
  for (const method of ["use", "get", "post", "put", "patch", "delete", "options", "all"]) {
    router[method] = () => router;
  }
  router.route = () => router;
  return router;
}

function stubFor(request) {
  if (request === "express") {
    const express = () => routerStub();
    express.Router = routerStub;
    express.json = middleware;
    express.urlencoded = middleware;
    express.static = middleware;
    return express;
  }

  if (request === "cookie-parser") return middleware;

  if (request === "pg") {
    return {
      Pool: class Pool {
        async query() {
          throw new Error("pg Pool query stub called during unit test");
        }

        async connect() {
          throw new Error("pg Pool connect stub called during unit test");
        }
      },
    };
  }

  if (request === "jsonwebtoken") {
    return {
      decode: () => null,
      sign: () => "stub.jwt.token",
      verify: () => {
        throw new Error("jsonwebtoken verify stub called during unit test");
      },
    };
  }

  if (request === "nanoid") {
    return {
      customAlphabet: () => () => "testid",
    };
  }

  return null;
}

function installExternalModuleFallbacks() {
  if (installed) return;
  installed = true;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const stub = stubFor(request);
    if (!stub) return originalLoad.apply(this, arguments);

    try {
      return originalLoad.apply(this, arguments);
    } catch (err) {
      if (err && err.code === "MODULE_NOT_FOUND") return stub;
      throw err;
    }
  };
}

module.exports = { installExternalModuleFallbacks };
