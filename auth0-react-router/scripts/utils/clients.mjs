import { $ } from "execa"
import ora from "ora"
import { ChangeAction, createChangeItem } from "./change-plan.mjs"

export function checkRegularClientChanges(domain, webConfig) {
  const { port, projectName } = webConfig
  const callbackUrl = `http://localhost:${port}/auth/callback`
  const logoutUrl = `http://localhost:${port}`

  return createChangeItem(ChangeAction.CREATE, {
    resource: "Regular Web Client",
    name: `${projectName}-web`,
    callbackUrl,
    logoutUrl,
  })
}

export async function applyRegularClientChanges(changePlan) {
  const spinner = ora(`Creating Regular Web Application: ${changePlan.name}`).start()
  try {
    const createArgs = [
      "apps",
      "create",
      "--name",
      changePlan.name,
      "--type",
      "regular",
      "--callbacks",
      changePlan.callbackUrl,
      "--logout-urls",
      changePlan.logoutUrl,
      "--json",
      "--no-input",
    ]
    const { stdout } = await $({ timeout: 30000 })`auth0 ${createArgs}`
    const client = JSON.parse(stdout)
    spinner.succeed(
      `Created Regular Web Application: ${changePlan.name} (${client.client_id})`
    )
    return client
  } catch (e) {
    spinner.fail("Failed to create Regular Web Application")
    throw e
  }
}
