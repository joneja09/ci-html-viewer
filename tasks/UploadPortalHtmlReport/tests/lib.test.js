const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { join } = require("path")
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync } = require("fs")
const { tmpdir } = require("os")
const { load } = require("cheerio")
const {
  findHtmlFiles,
  displayNameFor,
  generateAttachmentName,
  parseAttachmentName,
  isReportSuccessful,
  redactObject,
  redactHtmlDocument,
  shouldRedactKey,
  inlineLocalAssets,
  createReportArchive,
  parseSummaryPayload,
  sortHtmlFiles
} = require("../lib")

const fixtures = join(__dirname, "fixtures")

describe("findHtmlFiles", () => {
  test("finds html and htm files recursively and ignores other files", () => {
    const files = findHtmlFiles(fixtures).map((file) => displayNameFor(file, fixtures))
    assert.deepEqual(files, [
      "generic.html",
      "nested/deep/report.htm",
      "newman-fail.html",
      "newman-pass.html"
    ])
  })

  test("accepts a single HTML file", () => {
    const file = join(fixtures, "generic.html")
    assert.deepEqual(findHtmlFiles(file), [file])
  })

  test("returns an empty list for a directory with no HTML files", () => {
    const { mkdtempSync } = require("fs")
    const { tmpdir } = require("os")
    const emptyDir = mkdtempSync(join(tmpdir(), "html-report-empty-"))
    assert.deepEqual(findHtmlFiles(emptyDir), [])
  })

  test("rejects a non-HTML file", () => {
    assert.throws(() => findHtmlFiles(join(fixtures, "ignore.txt")), /not an HTML file/)
  })
})

describe("attachment names", () => {
  test("round-trips tab, job, stage, attempt, and nested file names", () => {
    const name = generateAttachmentName({
      tabName: "Playwright Report",
      jobName: "Run tests",
      stageName: "QA",
      stageAttempt: 2,
      fileName: "nested/deep/report.htm"
    })
    assert.equal(
      name,
      "Playwright Report~run-tests~qa~2~nested_deep_report.htm"
    )
    assert.deepEqual(parseAttachmentName(name), {
      tabName: "Playwright Report",
      jobName: "run-tests",
      stageName: "qa",
      stageAttempt: "2",
      fileName: "nested_deep_report.htm"
    })
  })

  test("parses legacy dot-delimited names", () => {
    const parsed = parseAttachmentName("Postman.job.stage.1.report.html")
    assert.equal(parsed.tabName, "Postman")
    assert.equal(parsed.fileName, "report.html")
  })
})

describe("isReportSuccessful", () => {
  test("detects Newman HTML Extra failures", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-fail.html"), "utf8")
    assert.equal(isReportSuccessful(html), false)
  })

  test("detects Newman HTML Extra passes", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-pass.html"), "utf8")
    assert.equal(isReportSuccessful(html), true)
  })

  test("treats generic HTML as successful", () => {
    const html = require("fs").readFileSync(join(fixtures, "generic.html"), "utf8")
    assert.equal(isReportSuccessful(html), true)
  })

  test("does not throw when Failed Tests is missing", () => {
    assert.equal(isReportSuccessful("<html></html>"), true)
  })

  test("detects Playwright unexpected failures", () => {
    assert.equal(isReportSuccessful('{"stats":{"expected":3,"unexpected":2}}'), false)
    assert.equal(isReportSuccessful('{"stats":{"expected":3,"unexpected":0}}'), true)
  })
})

describe("secret redaction", () => {
  test("redacts nested secret keys", () => {
    const redacted = redactObject({
      ok: true,
      password: "hunter2",
      nested: { access_token: "abc", user: "ada" },
      list: [{ refresh_token: "r" }]
    })
    assert.equal(redacted.ok, true)
    assert.equal(redacted.password, "***")
    assert.equal(redacted.nested.access_token, "***")
    assert.equal(redacted.nested.user, "ada")
    assert.equal(redacted.list[0].refresh_token, "***")
  })

  test("matches secret-like key names case-insensitively", () => {
    assert.equal(shouldRedactKey("Password"), true)
    assert.equal(shouldRedactKey("apiToken"), true)
    assert.equal(shouldRedactKey("user"), false)
  })

  test("masks bearer tokens and JSON secret fields in HTML", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-fail.html"), "utf8")
    const document = load(html)
    redactHtmlDocument(document)
    const output = document.html()
    assert.match(output, /Bearer \*\*\*/)
    assert.doesNotMatch(output, /super-secret-token/)
    assert.doesNotMatch(output, /hunter2/)
    assert.doesNotMatch(output, /abc123/)
    assert.match(output, /"user": "ada"/)
  })
})

describe("sortHtmlFiles", () => {
  test("puts index.html first", () => {
    const sorted = sortHtmlFiles([
      "/tmp/reports/other.html",
      "/tmp/reports/index.html",
      "/tmp/reports/about.html"
    ]).map((file) => file.split("/").pop())
    assert.deepEqual(sorted, ["index.html", "about.html", "other.html"])
  })
})

describe("inlineLocalAssets", () => {
  test("inlines local css, js, images, and css url() references", () => {
    const dir = mkdtempSync(join(tmpdir(), "html-inline-"))
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
    writeFileSync(join(dir, "logo.png"), png)
    writeFileSync(join(dir, "style.css"), "body { background: url('./logo.png'); color: red; }")
    writeFileSync(join(dir, "app.js"), "window.READY = true;")
    writeFileSync(
      join(dir, "index.html"),
      "<html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><img src=\"logo.png\"><script src=\"app.js\"></script></body></html>"
    )

    const result = inlineLocalAssets(
      readFileSync(join(dir, "index.html"), "utf8"),
      join(dir, "index.html"),
      dir
    )
    assert.equal(result.warnings.length, 0)
    assert.ok(result.inlined.indexOf("style.css") >= 0)
    assert.ok(result.inlined.indexOf("app.js") >= 0)
    assert.doesNotMatch(result.html, /href="style\.css"/)
    assert.doesNotMatch(result.html, /src="app\.js"/)
    assert.doesNotMatch(result.html, /src="logo\.png"/)
    assert.match(result.html, /<style>/)
    assert.match(result.html, /window\.READY = true/)
    assert.match(result.html, /data:image\/png;base64,/)
    assert.match(result.html, /data:image\/png;base64,/)
  })

  test("leaves remote and missing assets alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "html-inline-remote-"))
    const html = "<html><head><link rel=\"stylesheet\" href=\"https://cdn.example/app.css\"></head><body><img src=\"missing.png\"></body></html>"
    writeFileSync(join(dir, "index.html"), html)
    const result = inlineLocalAssets(html, join(dir, "index.html"), dir)
    assert.match(result.html, /https:\/\/cdn\.example\/app\.css/)
    assert.match(result.html, /src="missing\.png"/)
  })
})

describe("createReportArchive", () => {
  test("zips directory files and skips node_modules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "html-zip-"))
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "index.html"), "<html></html>")
    writeFileSync(join(dir, "style.css"), "body{}")
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports=1")
    const out = join(dir, "out.zip")
    const result = await createReportArchive(dir, out)
    assert.equal(result.skipped, false)
    assert.equal(result.files, 2)
    assert.ok(readFileSync(out).length > 0)
  })
})

describe("parseSummaryPayload", () => {
  test("reads legacy array summaries", () => {
    const parsed = parseSummaryPayload([{ name: "a", successful: true }])
    assert.equal(parsed.reports.length, 1)
    assert.equal(parsed.archive, null)
  })

  test("reads version 2 summaries with an archive", () => {
    const parsed = parseSummaryPayload({
      version: 2,
      reports: [{ name: "a" }],
      archive: { name: "zip", fileName: "html-reports.zip" }
    })
    assert.equal(parsed.reports.length, 1)
    assert.equal(parsed.archive.fileName, "html-reports.zip")
  })
})

