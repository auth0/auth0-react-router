#!/usr/bin/env node
import path from "node:path"
import crypto from "node:crypto"

import {
  checkNodeVersion,
  checkAuth0CLI,
  getActiveTenant,
  validateWebProject,
} from "./utils/validation.mjs"
import {
  discoverExistingConnections,
  buildChangePlan,
  displayChangePlan,
} from "./utils/discovery.mjs"
import { applyRegularClientChanges } from "./utils/clients.mjs"
import {
  applyDatabaseConnectionChanges,
  checkDatabaseConnectionChanges,
} from "./utils/connections.mjs"
import { writeEnvFile } from "./utils/env-writer.mjs"
import { confirmWithUser } from "./utils/helpers.mjs"

async function main() {
  console.log("\n  Auth0 React Router Bootstrap\n")

  const projectPath = path.resolve(process.argv[2] || process.cwd())

  // Pre-flight
  checkNodeVersion()
  await checkAuth0CLI()
  const domain = await getActiveTenant()

  // Validate project
  const config = validateWebProject(projectPath)

  // Discover + plan
  const connections = await discoverExistingConnections()
  const plan = buildChangePlan(connections, domain, config)
  displayChangePlan(plan)

  // Confirm
  const confirmed = await confirmWithUser("Apply these changes?")
  if (!confirmed) {
    console.log("\n  Aborted by user.\n")
    process.exit(0)
  }

  // Execute
  console.log("")
  const client = await applyRegularClientChanges(plan.client)

  plan.connection = checkDatabaseConnectionChanges(connections, client.client_id)
  await applyDatabaseConnectionChanges(plan.connection, client.client_id)

  const sessionSecret = crypto.randomBytes(32).toString("base64")
  const envPath = path.join(projectPath, ".env")

  await writeEnvFile(
    {
      AUTH0_DOMAIN: domain,
      AUTH0_CLIENT_ID: client.client_id,
      AUTH0_CLIENT_SECRET: client.client_secret,
      AUTH0_SESSION_SECRET: sessionSecret,
    },
    envPath
  )

  // Summary
  console.log("\n  Auth0 React Router Setup Complete\n")
  console.log(`  Domain:          ${domain}`)
  console.log(`  Client ID:       ${client.client_id}`)
  console.log(`  Session Secret:  (generated, written to .env)`)
  console.log("")
  console.log("  Remaining manual steps:")
  console.log(`  1. In Auth0 Dashboard → Applications → ${plan.client.name}:`)
  console.log(`     Allowed Callback URLs: http://localhost:5173/auth/callback`)
  console.log(`     Allowed Logout URLs:   http://localhost:5173`)
  console.log(`     Allowed Web Origins:   http://localhost:5173`)
  console.log("  2. Add .env to .gitignore")
  console.log("  3. Run: npm run dev")
  console.log("")
}

main().catch((e) => {
  console.error(`\n  Bootstrap failed: ${e.message}\n`)
  process.exit(1)
})
