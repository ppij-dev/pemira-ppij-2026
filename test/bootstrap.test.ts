import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  buildBootstrapStatements,
  escapeSqlString,
  extractD1Results,
  main,
  parseBootstrapArgs,
  REQUIRED_CONFIG,
  runRemoteBootstrap,
  USAGE_TEXT,
  validateConfig,
  validateSiteScope,
} from "../scripts/bootstrap.mjs";

const validConfig = {
  ONELOGIN_ISSUER: "https://login.example/realm",
  ONELOGIN_CLIENT_ID: "client-id",
  ONELOGIN_CLIENT_SECRET: "top-secret-client-secret",
  SERVICE_API_URL: "https://service.example",
  SERVICE_API_CLIENT_ID: "service-client",
  SERVICE_API_CLIENT_SECRET: "top-secret-service-secret",
  SITE_SCOPE: "/ppij/okayama",
  SITE_BASE_URL: "https://vote.example",
  SITE_NAME: "Pemilihan PPI Jepang",
  SITE_LOGO_PATH: "/custom-logo.svg",
  APP_MASTER_KEY: "top-secret-master-key",
};

describe("bootstrap SQL builder and escaping", () => {
  it("escapes SQL strings properly", () => {
    expect(escapeSqlString("simple")).toBe("'simple'");
    expect(escapeSqlString("O'Connor and PPI's")).toBe("'O''Connor and PPI''s'");
    expect(escapeSqlString("")).toBe("''");
    expect(escapeSqlString(null)).toBe("NULL");
    expect(escapeSqlString(undefined)).toBe("NULL");
  });

  it("contains exactly the intended inserts with escaped literals and no secrets", () => {
    const fixedNow = "2026-10-21T12:00:00.000Z";
    const statements = buildBootstrapStatements({
      memberId: "member'123",
      siteName: "PPI Okayama's Election",
      siteScope: "Korda/Chugoku",
      siteBaseUrl: "https://vote.okayama.example",
      siteLogoPath: "/okayama.svg",
      now: fixedNow,
    });

    expect(statements).toHaveLength(4);

    // 1. Election draft row
    expect(statements[0]).toBe(
      "INSERT INTO elections (title, status_lock) SELECT 'PPI Okayama''s Election', 'draft' WHERE NOT EXISTS (SELECT 1 FROM elections)"
    );

    // 2. Admin voting row (is_technical=1, Technical Admin)
    expect(statements[1]).toBe(
      `INSERT INTO admin_voting (member_id, name, is_technical, created_at) VALUES ('member''123', 'Technical Admin', 1, '${fixedNow}')`
    );

    // 3. System config (site_scope, site_base_url, site_name, site_logo_path)
    expect(statements[2]).toBe(
      "INSERT INTO system_config (key, value) VALUES ('site_scope', 'Korda/Chugoku'), ('site_base_url', 'https://vote.okayama.example'), ('site_name', 'PPI Okayama''s Election'), ('site_logo_path', '/okayama.svg') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    );

    // 4. Initialized = 1
    expect(statements[3]).toBe(
      "INSERT INTO system_config (key, value) VALUES ('initialized', '1') ON CONFLICT(key) DO UPDATE SET value='1'"
    );

    // Verify secrets are NOT present anywhere in generated SQL
    const fullSql = statements.join("\n");
    expect(fullSql).not.toContain("top-secret-client-secret");
    expect(fullSql).not.toContain("top-secret-service-secret");
    expect(fullSql).not.toContain("top-secret-master-key");
  });
});

describe("bootstrap CLI arguments and configuration parsing", () => {
  it("parses local and remote argument variations", () => {
    expect(parseBootstrapArgs(["member-001"])).toEqual({
      isRemote: false,
      database: "",
      dryRun: false,
      memberId: "member-001",
    });

    expect(
      parseBootstrapArgs(["--remote", "--database", "election-d1", "member-002"])
    ).toEqual({
      isRemote: true,
      database: "election-d1",
      dryRun: false,
      memberId: "member-002",
    });

    expect(
      parseBootstrapArgs(["--remote", "--database=election-prod", "--dry-run", "member-003"])
    ).toEqual({
      isRemote: true,
      database: "election-prod",
      dryRun: true,
      memberId: "member-003",
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseBootstrapArgs(["--remte", "member-001"])).toThrow(USAGE_TEXT);
    expect(() => parseBootstrapArgs(["--foo", "member-001"])).toThrow(USAGE_TEXT);
  });

  it("rejects a second positional argument", () => {
    expect(() => parseBootstrapArgs(["member-001", "member-002"])).toThrow(USAGE_TEXT);
    expect(() =>
      parseBootstrapArgs(["--remote", "--database", "db", "member-001", "member-002"])
    ).toThrow(USAGE_TEXT);
  });

  it("rejects --database without --remote", () => {
    expect(() => parseBootstrapArgs(["--database", "election-db", "member-001"])).toThrow(USAGE_TEXT);
    expect(() => parseBootstrapArgs(["-d", "election-db", "member-001"])).toThrow(USAGE_TEXT);
    expect(() => parseBootstrapArgs(["--database=election-db", "member-001"])).toThrow(USAGE_TEXT);
  });

  it("rejects --database value starting with - or empty", () => {
    expect(() =>
      parseBootstrapArgs(["--remote", "--database", "-election-db", "member-001"])
    ).toThrow(USAGE_TEXT);
    expect(() =>
      parseBootstrapArgs(["--remote", "--database=-election-db", "member-001"])
    ).toThrow(USAGE_TEXT);
    expect(() =>
      parseBootstrapArgs(["--remote", "--database", "--dry-run", "member-001"])
    ).toThrow(USAGE_TEXT);
  });

  it("rejects --remote without --database", () => {
    expect(() => parseBootstrapArgs(["--remote", "member-001"])).toThrow(USAGE_TEXT);
  });

  it("validates required operator configuration", () => {
    expect(validateConfig(validConfig)).toBe(true);
    expect(validateConfig({ ...validConfig, APP_MASTER_KEY: "" })).toBe(false);
    expect(validateConfig({ ...validConfig, ONELOGIN_CLIENT_SECRET: " " })).toBe(false);
    expect(validateConfig(null)).toBe(false);
  });

  it("main exits non-zero and does not touch remote or local on rejected argv forms", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejectedForms = [
      ["--remte", "member-001"],
      ["member-001", "member-002"],
      ["--database", "some-db", "member-001"],
      ["--remote", "--database", "-bad-db", "member-001"],
      ["--remote", "member-001"],
    ];

    for (const argv of rejectedForms) {
      process.exitCode = 0;
      const mockExecutor = vi.fn();
      await main(argv, { executor: mockExecutor, env: validConfig });
      expect(process.exitCode).toBe(1);
      expect(mockExecutor).not.toHaveBeenCalled();
    }
    errorSpy.mockRestore();
  });
});

describe("D1 output extraction and error handling", () => {
  it("extracts results array from valid D1 JSON output", () => {
    expect(
      extractD1Results(JSON.stringify([{ results: [{ value: "1" }], success: true }]))
    ).toEqual([{ value: "1" }]);

    expect(
      extractD1Results(JSON.stringify([{ results: [], success: true }]))
    ).toEqual([]);
  });

  it("throws when stdout cannot be parsed as JSON", () => {
    expect(() => extractD1Results("Error: connection refused")).toThrow(
      "Keluaran basis data D1 tidak dapat diurai sebagai JSON."
    );
    expect(() => extractD1Results("")).toThrow("Keluaran basis data D1 kosong.");
    expect(() => extractD1Results(null)).toThrow("Keluaran basis data D1 kosong.");
  });

  it("throws when parsed JSON has no results array", () => {
    expect(() => extractD1Results(JSON.stringify([{ success: true }]))).toThrow(
      "Keluaran basis data D1 tidak memiliki array hasil."
    );
    expect(() => extractD1Results(JSON.stringify([]))).toThrow(
      "Keluaran basis data D1 tidak memiliki array hasil."
    );
    expect(() => extractD1Results(JSON.stringify({ success: true }))).toThrow(
      "Keluaran basis data D1 tidak memiliki array hasil."
    );
  });
});

describe("remote bootstrap execution", () => {
  it("executes remote bootstrap with wrangler argv containing --remote and --file, and cleans up temp file", async () => {
    const executedCalls: { bin: string; args: string[] }[] = [];
    let tempSqlFilePath = "";
    let tempSqlContent = "";

    const mockExecutor = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      executedCalls.push({ bin, args });

      // First query: initialized check
      if (args.includes("SELECT value FROM system_config WHERE key='initialized'")) {
        return { stdout: JSON.stringify([{ results: [], success: true }]) };
      }

      // Second query: admin check
      if (args.includes("SELECT member_id FROM admin_voting")) {
        return { stdout: JSON.stringify([{ results: [], success: true }]) };
      }

      // Third call: wrangler d1 execute --file <tempFile>
      if (args.includes("--file")) {
        const fileIndex = args.indexOf("--file");
        tempSqlFilePath = args[fileIndex + 1];
        // Read file before it is deleted to inspect its contents
        tempSqlContent = await readFile(tempSqlFilePath, "utf8");
        return { stdout: "Success" };
      }

      return { stdout: "" };
    });

    const result = await runRemoteBootstrap({
      database: "ppij-election-db",
      memberId: "admin-tech-01",
      config: validConfig,
      executor: mockExecutor,
    });

    expect(result).toEqual({ success: true });
    expect(executedCalls).toHaveLength(3);

    // Call 1: Check initialized
    expect(executedCalls[0].bin).toBe("wrangler");
    expect(Array.isArray(executedCalls[0].args)).toBe(true);
    expect(executedCalls[0].args).toEqual([
      "d1",
      "execute",
      "ppij-election-db",
      "--remote",
      "--json",
      "--command",
      "SELECT value FROM system_config WHERE key='initialized'",
    ]);

    // Call 2: Check admins
    expect(executedCalls[1].bin).toBe("wrangler");
    expect(Array.isArray(executedCalls[1].args)).toBe(true);
    expect(executedCalls[1].args).toEqual([
      "d1",
      "execute",
      "ppij-election-db",
      "--remote",
      "--json",
      "--command",
      "SELECT member_id FROM admin_voting",
    ]);

    // Call 3: Write SQL file
    expect(executedCalls[2].bin).toBe("wrangler");
    expect(Array.isArray(executedCalls[2].args)).toBe(true);
    expect(executedCalls[2].args).toContain("d1");
    expect(executedCalls[2].args).toContain("execute");
    expect(executedCalls[2].args).toContain("ppij-election-db");
    expect(executedCalls[2].args).toContain("--remote");
    expect(executedCalls[2].args).toContain("--file");
    expect(tempSqlFilePath).toMatch(/bootstrap\.sql$/);

    // Verify written SQL content matches statements
    expect(tempSqlContent).toContain("INSERT INTO elections");
    expect(tempSqlContent).toContain("INSERT INTO admin_voting");
    expect(tempSqlContent).toContain("INSERT INTO system_config");
    expect(tempSqlContent).toContain("'admin-tech-01'");

    // Verify temp file is deleted after execution completes
    expect(existsSync(tempSqlFilePath)).toBe(false);
  });

  it("short-circuits already-initialized check without executing the write", async () => {
    const executedCalls: { bin: string; args: string[] }[] = [];

    const mockExecutor = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      executedCalls.push({ bin, args });
      if (args.includes("SELECT value FROM system_config WHERE key='initialized'")) {
        return { stdout: JSON.stringify([{ results: [{ value: "1" }], success: true }]) };
      }
      return { stdout: "" };
    });

    const result = await runRemoteBootstrap({
      database: "ppij-election-db",
      memberId: "admin-tech-01",
      config: validConfig,
      executor: mockExecutor,
    });

    expect(result).toEqual({ alreadyInitialized: true });
    // Exactly 1 call was made (the check), no admin check and no write
    expect(executedCalls).toHaveLength(1);
    expect(executedCalls[0].args).toContain("SELECT value FROM system_config WHERE key='initialized'");
    expect(executedCalls.some((c) => c.args.includes("--file"))).toBe(false);
  });

  it("aborts when partial state exists (admins exist without initialized site)", async () => {
    const executedCalls: { bin: string; args: string[] }[] = [];

    const mockExecutor = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      executedCalls.push({ bin, args });

      if (args.includes("SELECT value FROM system_config WHERE key='initialized'")) {
        return { stdout: JSON.stringify([{ results: [], success: true }]) };
      }

      if (args.includes("SELECT member_id FROM admin_voting")) {
        return {
          stdout: JSON.stringify([
            { results: [{ member_id: "orphan-admin-99" }], success: true },
          ]),
        };
      }

      return { stdout: "" };
    });

    await expect(
      runRemoteBootstrap({
        database: "ppij-election-db",
        memberId: "admin-tech-01",
        config: validConfig,
        executor: mockExecutor,
      })
    ).rejects.toThrow(
      "Data bootstrap parsial: admin sudah ada tanpa situs terinisialisasi; operator perlu memeriksa basis data."
    );

    // Exactly 2 check calls made, write was NOT executed
    expect(executedCalls).toHaveLength(2);
    expect(executedCalls.some((c) => c.args.includes("--file"))).toBe(false);
  });

  it("aborts when pre-check stdout cannot be parsed as JSON with no write call", async () => {
    const executedCalls: { bin: string; args: string[] }[] = [];

    const mockExecutor = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      executedCalls.push({ bin, args });
      // Return unparseable string
      return { stdout: "Error: 502 Bad Gateway" };
    });

    await expect(
      runRemoteBootstrap({
        database: "ppij-election-db",
        memberId: "admin-tech-01",
        config: validConfig,
        executor: mockExecutor,
      })
    ).rejects.toThrow("Keluaran basis data D1 tidak dapat diurai sebagai JSON.");

    // Exactly 1 pre-check call made, write was NOT executed
    expect(executedCalls).toHaveLength(1);
    expect(executedCalls.some((c) => c.args.includes("--file"))).toBe(false);
  });

  it("aborts when pre-check stdout has no results array with no write call", async () => {
    const executedCalls: { bin: string; args: string[] }[] = [];

    const mockExecutor = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      executedCalls.push({ bin, args });
      // Return JSON without results array
      return { stdout: JSON.stringify([{ success: false, errors: ["table not found"] }]) };
    });

    await expect(
      runRemoteBootstrap({
        database: "ppij-election-db",
        memberId: "admin-tech-01",
        config: validConfig,
        executor: mockExecutor,
      })
    ).rejects.toThrow("Keluaran basis data D1 tidak memiliki array hasil.");

    // Exactly 1 pre-check call made, write was NOT executed
    expect(executedCalls).toHaveLength(1);
    expect(executedCalls.some((c) => c.args.includes("--file"))).toBe(false);
  });

  it("prints SQL without executing when --dry-run is specified", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const mockExecutor = vi.fn();

    await main(
      ["--remote", "--database", "ppij-election-db", "--dry-run", "admin-dry-run"],
      {
        executor: mockExecutor,
        env: validConfig,
      }
    );

    expect(mockExecutor).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    const loggedOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(loggedOutput).toContain("INSERT INTO elections");
    expect(loggedOutput).toContain("'admin-dry-run'");
    expect(loggedOutput).not.toContain("top-secret-client-secret");
    logSpy.mockRestore();
  });
});

describe("SITE_SCOPE validation", () => {
  it("accepts valid group path formats starting with / and containing no whitespace", () => {
    expect(validateSiteScope("/ppij/okayama")).toBe(true);
    expect(validateSiteScope("/ppij")).toBe(true);
    expect(validateSiteScope("/ppij/korda-chugoku")).toBe(true);
    expect(validateSiteScope("/ppij/komsat/tokyo")).toBe(true);
  });

  it("rejects invalid scope formats", () => {
    expect(validateSiteScope("Korda/Jepang")).toBe(false);
    expect(validateSiteScope("ppij/okayama")).toBe(false);
    expect(validateSiteScope("/ppij okayama")).toBe(false);
    expect(validateSiteScope("")).toBe(false);
    expect(validateSiteScope("   ")).toBe(false);
    expect(validateSiteScope(null as unknown as string)).toBe(false);
    expect(validateSiteScope(undefined as unknown as string)).toBe(false);
  });

  it("fails fast in main with exit code 1 and error message on invalid SITE_SCOPE", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExecutor = vi.fn();
    process.exitCode = 0;

    await main(["member-001"], {
      executor: mockExecutor,
      env: { ...validConfig, SITE_SCOPE: "Korda/Jepang" },
    });

    expect(process.exitCode).toBe(1);
    expect(mockExecutor).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("SITE_SCOPE tidak valid")
    );
    errorSpy.mockRestore();
  });
});
