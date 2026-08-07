import * as fs from "fs";
import * as path from "path";
import Mocha = require("mocha");

async function main() {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  fs.readdirSync(__dirname)
    .filter((fileName) => fileName.endsWith(".test.js"))
    .sort()
    .forEach((fileName) => mocha.addFile(path.resolve(__dirname, fileName)));

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
