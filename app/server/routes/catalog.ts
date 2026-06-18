// GET /api/scenarios?set=basic → { features, scenarios, sets }

import { Hono } from "hono";
import { loadScenarioSet, listScenarioSets } from "../../src/scenarioStore";

const app = new Hono();

app.get("/", (c) => {
  const set = c.req.query("set") ?? "basic";
  const { features, scenarios } = loadScenarioSet(set);
  return c.json({ features, scenarios, sets: listScenarioSets() });
});

export default app;
