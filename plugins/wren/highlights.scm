; Keywords
[
  "class"
  "construct"
  "foreign"
  "static"
  "var"
  "import"
  "for"
  "in"
  "if"
  "else"
  "while"
  "return"
  "is"
  "as"
  "super"
] @keyword

(this) @keyword
(break_statement) @keyword
(continue_statement) @keyword

; Literals
(string) @string
(raw_string) @string
(number) @number
(boolean) @boolean
(null) @constant.builtin

; Comments
(line_comment) @comment
(block_comment) @comment

; Operators
[
  "="
  "?"
  ":"
  "+"
  "-"
  "*"
  "/"
  "%"
  ".."
  "..."
  "<<"
  ">>"
  "&"
  "^"
  "|"
  "<"
  "<="
  ">"
  ">="
  "=="
  "!="
  "&&"
  "||"
  "!"
  "~"
] @operator

; Delimiters
["(" ")"] @punctuation.bracket
["[" "]"] @punctuation.bracket
["{" "}"] @punctuation.bracket
["," "."] @punctuation.delimiter

; Declarations
(class_definition
  name: (identifier) @type)

(constructor_definition
  name: (identifier) @constructor)

(named_method
  name: (identifier) @function.method)

(getter_definition
  name: (identifier) @function.method)

(setter_definition
  name: (identifier) @function.method)

(foreign_named_method
  name: (identifier) @function.method)

(foreign_getter
  name: (identifier) @function.method)

(var_statement
  name: (identifier) @variable)

; Calls
(call_expression
  target: (identifier) @function)

(method_call_expression
  method: (identifier) @function.method)

(super_expression
  method: (identifier) @function.method)

; Parameters
(parameter_list
  (identifier) @variable.parameter)

(closure_parameter_list
  (identifier) @variable.parameter)

(subscript_parameter_list
  (identifier) @variable.parameter)

; Imports
(import_variable
  name: (identifier) @variable)

(import_variable
  alias: (identifier) @variable)

(import_statement
  path: (string) @string.special)

; Fields and attributes
(field) @property
(static_field) @property

(attribute
  name: (identifier) @attribute)

(attribute_entry
  key: (identifier) @attribute)

; Fallback
(identifier) @variable
