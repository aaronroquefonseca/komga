module.exports = {
  preset: '@vue/cli-plugin-unit-jest/presets/typescript-and-babel',
  testMatch: [
    '**/tests/unit/**/*.spec.[jt]s?(x)',
    '**/__tests__/*.[jt]s?(x)',
    // colocated unit tests (e.g. src/functions/*.test.ts, scripts/*.test.ts)
    '**/*.test.[jt]s?(x)',
  ],
}
