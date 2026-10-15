const express = require("express");
module.exports = () => {
  const router = express.Router();
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const original = router[method];
    router[method] = function (path, ...handlers) {
      return original.call(
        this,
        path,
        ...handlers.map((fn) =>
          fn.constructor.name === "AsyncFunction"
            ? async (req, res, next) => {
                try {
                  await fn(req, res, next);
                } catch (e) {
                  if (res.headersSent) return next(e);
                  if (!e.status) console.error("Request failed:", e.message);
                  res
                    .status(e.status || 500)
                    .json({
                      error: e.status
                        ? e.message
                        : "Could not complete this operation. Please try again.",
                    });
                }
              }
            : fn,
        ),
      );
    };
  }
  return router;
};
