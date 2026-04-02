/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Relax some settings to allow test files to run without the full Next.js build
          strict: false,
          esModuleInterop: true,
          moduleResolution: "node",
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  collectCoverageFrom: [
    "src/lib/view-models/**/*.ts",
    "src/lib/research/types.ts",
  ],
};
