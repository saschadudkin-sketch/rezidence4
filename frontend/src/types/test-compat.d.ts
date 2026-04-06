// Temporary FE-04 compatibility layer for legacy tests under tsconfig.ci no-exclusions.

interface Function {
  mock?: any;
  mockReturnValue?(value: any): any;
  mockReturnValueOnce?(value: any): any;
  mockResolvedValue?(value: any): any;
  mockResolvedValueOnce?(value: any): any;
  mockRejectedValue?(value: any): any;
  mockRejectedValueOnce?(value: any): any;
  mockImplementation?(fn: (...args: any[]) => any): any;
  mockImplementationOnce?(fn: (...args: any[]) => any): any;
  mockRestore?(): void;
  resolve?(id: string): any;
}

interface HTMLElement {
  value?: string;
}

interface ChildNode {
  getAttribute?(qualifiedName: string): string | null;
}

declare module 'fs' {
  export const readFileSync: any;
  const fsAny: any;
  export default fsAny;
}

declare module 'path' {
  export const resolve: any;
  const pathAny: any;
  export default pathAny;
}

interface NotificationConstructor {
  new (...args: any[]): any;
  prototype?: any;
  permission?: any;
  requestPermission?: (...args: any[]) => any;
}

declare var Notification: NotificationConstructor;
