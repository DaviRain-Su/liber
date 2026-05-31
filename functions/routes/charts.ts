import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { getCharts } from "../lib/charts";

// Open rankings — seed baselines overlaid with live D1 event signals.
const charts = new Hono<{ Bindings: Env; Variables: Variables }>();

charts.get("/", async (c) => {
  const win = c.req.query("window") || "today";
  // Rankings are deterministic per window and change slowly — let the browser/edge
  // cache them for a minute instead of recomputing the aggregates every navigation.
  c.header("Cache-Control", "public, max-age=60");
  return c.json(await getCharts(c.env, win));
});

export default charts;
