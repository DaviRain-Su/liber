import { Hono } from "hono";
import type { Env, Variables } from "../lib/types";
import { getCharts } from "../lib/charts";

// Open rankings — seed baselines overlaid with live D1 event signals.
const charts = new Hono<{ Bindings: Env; Variables: Variables }>();

charts.get("/", async (c) => {
  const win = c.req.query("window") || "today";
  return c.json(await getCharts(c.env, win));
});

export default charts;
