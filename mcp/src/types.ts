/** MCP handlers wrap their domain result in this stdio content envelope. */
export interface ToolReply {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}
