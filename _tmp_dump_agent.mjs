import { createClient } from "@supabase/supabase-js";
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key);

const { data, error } = await sb
  .from("agents")
  .select("*")
  .eq("id", "205c2205-21c5-47a2-9405-2b743e08e00c")
  .single();

if (error) { console.error(error); process.exit(1); }
const fs = await import("fs");
fs.writeFileSync("/tmp/agent_205c.json", JSON.stringify(data, null, 2));
console.log("keys:", Object.keys(data));
console.log("settings keys:", Object.keys(data.settings || {}));
console.log("size:", JSON.stringify(data).length);
