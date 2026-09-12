// The context block formatters other plugins call (workflows, memory). The implementation and its
// test live in shared/, because contract/ holds only what crosses a package boundary and no tests.
export * from '../shared/contextBlock'
