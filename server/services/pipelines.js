// All pipeline/deal mutations lock the workspace first to serialize stage moves/deletion.
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const defaults = [
  ["Contacted", "#3b82f6"],
  ["Interested", "#6366f1"],
  ["Offer sent", "#f59e0b"],
  ["Closing", "#10b981"],
  ["Closed", "#64748b"],
];
async function ensure(client, wid) {
  if (
    !(
      await client.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        wid,
      ])
    ).rows.length
  )
    throw fail("Workspace not found.", 404);
  let pipeline = (
    await client.query(
      "SELECT * FROM sales_pipelines WHERE workspace_id=$1 AND is_default",
      [wid],
    )
  ).rows[0];
  const created = !pipeline;
  if (!pipeline)
    pipeline = (
      await client.query(
        "INSERT INTO sales_pipelines(workspace_id,name,is_default) VALUES($1,'Sales',true) RETURNING *",
        [wid],
      )
    ).rows[0];
  await client.query(
    "UPDATE pipeline_stages SET pipeline_id=$1 WHERE workspace_id=$2 AND pipeline_id IS NULL",
    [pipeline.id, wid],
  );
  await client.query(
    "UPDATE deals SET pipeline_id=$1 WHERE workspace_id=$2 AND pipeline_id IS NULL",
    [pipeline.id, wid],
  );
  if (
    !(
      await client.query(
        "SELECT id FROM pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 LIMIT 1",
        [wid, pipeline.id],
      )
    ).rows.length
  ) {
    // Only seed on a new workspace. An intentionally empty existing pipeline stays empty.
    if (created) await seed(client, wid, pipeline.id);
  }
  return pipeline;
}
async function seed(client, wid, id) {
  for (let i = 0; i < defaults.length; i++)
    await client.query(
      "INSERT INTO pipeline_stages(workspace_id,pipeline_id,name,color,sort_order) VALUES($1,$2,$3,$4,$5)",
      [wid, id, ...defaults[i], i],
    );
}
async function selected(client, wid, id) {
  if (id == null || id === "") return ensure(client, wid);
  const number = Number(id);
  if (!Number.isSafeInteger(number) || number < 1)
    throw fail("Invalid pipeline.");
  const pipeline = (
    await client.query(
      "SELECT * FROM sales_pipelines WHERE id=$1 AND workspace_id=$2",
      [number, wid],
    )
  ).rows[0];
  if (!pipeline) throw fail("Pipeline not found.", 404);
  return pipeline;
}
async function transaction(pool, wid, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const first = await ensure(client, wid);
    const result = await fn(client, first);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { ensure, selected, seed, transaction };
