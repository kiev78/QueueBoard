// Basic Jest config for Angular services/components without path mapping.

module.exports = {
  testEnvironment: 'jsdom',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs'],
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['**/?(*.)+(spec|test).[tj]s'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/build/'
  ],
  moduleNameMapper: {
    '\\.(html|css|scss)$': 'identity-obj-proxy'
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript'
      ]
    }],
    '^.+\\.(js|mjs)$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@angular|rxjs)/)'
  ],
  verbose: true,
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/main.server.ts',
    '!src/server.ts'
  ],
  coverageDirectory: 'coverage-jest',
  testTimeout: 10000
};
