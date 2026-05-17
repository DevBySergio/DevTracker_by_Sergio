import * as path from "path";
import Mocha = require("mocha");

async function main() {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  mocha.addFile(path.resolve(__dirname, "extension.test.js"));

  const failures = await new Promise<number>((resolve) => {
    mocha.run((failureCount) => resolve(failureCount));
  });

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
