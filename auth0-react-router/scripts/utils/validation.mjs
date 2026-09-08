import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import ora from "ora"

export function checkNodeVersion() {
  const version = process.version
  const major = parseInt(version.slice(1).split(".")[0], 10)
  if (major < 20) {
    console.error(`\n  Node.js 20+ required. Found: ${version}\n`)
    console.error("  Install Node.js 20+: https://nodejs.org/\n")
    process.exit(1)
  }
}

export async function checkAuth0CLI() {
  const spinner = ora("Checking Auth0 CLI").start()
  try {
    execSync("auth0 --version", { stdio: "ignore" })
    spinner.succeed("Auth0 CLI is installed")
  } catch {
    spinner.fail("Auth0 CLI not found")
    console.error("\n  Install Auth0 CLI: https://github.com/auth0/auth0-cli\n")
    process.exit(1)
  }
}

export async function getActiveTenant() {
  const spinner = ora("Getting active Auth0 tenant").start()
  try {
    const output = execSync("auth0 tenants list --csv --no-input", {
      encoding: "utf-8",
    }).trim()
    const lines = output.split("\n").filter(Boolean)
    if (lines.length === 0) {
      spinner.fail("No active Auth0 tenant found")
      console.error("\n  Log in first: auth0 login\n")
      process.exit(1)
    }
    // CSV format: domain,active — find the active one
    const activeLine = lines.find((l) => l.endsWith(",true")) || lines[0]
    const domain = activeLine.split(",")[0].trim()
    spinner.succeed(`Active tenant: ${domain}`)
    return domain
  } catch (e) {
    spinner.fail("Failed to get active tenant")
    console.error("\n  Log in first: auth0 login\n")
    process.exit(1)
  }
}

export function validateWebProject(projectPath) {
  const spinner = ora("Validating React Router project").start()

  if (!fs.existsSync(projectPath)) {
    spinner.fail(`Project path not found: ${projectPath}`)
    process.exit(1)
  }

  const packageJsonPath = path.join(projectPath, "package.json")
  if (!fs.existsSync(packageJsonPath)) {
    spinner.fail("No package.json found — is this a Node.js project?")
    process.exit(1)
  }

  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
  } catch {
    spinner.fail("Could not parse package.json")
    process.exit(1)
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  }

  // Detect React Router version
  const rrVersion = allDeps["react-router"]
  const hasReactRouter = rrVersion && parseInt(rrVersion.replace(/[^0-9]/, ""), 10) >= 7

  // Detect framework mode (react-router.config.ts or react-router.config.js)
  const hasFrameworkConfig =
    fs.existsSync(path.join(projectPath, "react-router.config.ts")) ||
    fs.existsSync(path.join(projectPath, "react-router.config.js"))

  if (!hasReactRouter) {
    spinner.fail("react-router v7+ not found in dependencies")
    console.error(
      "\n  This bootstrap requires a React Router v7 framework-mode project.\n" +
        "  Create one: npx create-react-router@latest my-app\n"
    )
    process.exit(1)
  }

  // Detect dev server port from vite.config if present
  let port = 5173  // Vite default
  const viteConfigPath = [
    path.join(projectPath, "vite.config.ts"),
    path.join(projectPath, "vite.config.js"),
  ].find((p) => fs.existsSync(p))

  if (viteConfigPath) {
    const viteContent = fs.readFileSync(viteConfigPath, "utf-8")
    const portMatch = viteContent.match(/port\s*:\s*(\d+)/)
    if (portMatch) port = parseInt(portMatch[1], 10)
  }

  const projectName = pkg.name || path.basename(projectPath)
  spinner.succeed(
    `React Router v7 project: ${projectName} (port ${port}${hasFrameworkConfig ? ", framework mode" : ""})`
  )

  return { framework: "react-router", port, projectName, hasFrameworkConfig }
}
