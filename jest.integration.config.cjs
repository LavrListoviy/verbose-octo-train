/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  roots: ["<rootDir>/tests/integration"],
  testEnvironment: "node",
  testMatch: ["**/*.integration.test.ts"],
  testTimeout: 30000,
  transform: {
    "^.+\\.ts$": "babel-jest",
  },
  verbose: true,
};
