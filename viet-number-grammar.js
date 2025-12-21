// Generated automatically by nearley, version undefined
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }
var grammar = {
    Lexer: undefined,
    ParserRules: [
    {"name": "_$ebnf$1", "symbols": []},
    {"name": "_$ebnf$1", "symbols": ["wschar", "_$ebnf$1"], "postprocess": function arrconcat(d) {return [d[0]].concat(d[1]);}},
    {"name": "_", "symbols": ["_$ebnf$1"], "postprocess": function(d) {return null;}},
    {"name": "__$ebnf$1", "symbols": ["wschar"]},
    {"name": "__$ebnf$1", "symbols": ["wschar", "__$ebnf$1"], "postprocess": function arrconcat(d) {return [d[0]].concat(d[1]);}},
    {"name": "__", "symbols": ["__$ebnf$1"], "postprocess": function(d) {return null;}},
    {"name": "wschar", "symbols": [/[ \t\n\v\f]/], "postprocess": id},
    {"name": "main", "symbols": []},
    {"name": "main", "symbols": ["num", "__", "unit", "__", "main"], "postprocess": ([n, _1, u, _2, m]) => n * u + m},
    {"name": "main", "symbols": ["num", "__", "unit"], "postprocess": ([n, _, u]) => n * u},
    {"name": "main", "symbols": ["num"], "postprocess": ([n]) => n},
    {"name": "main", "symbols": ["synonym"], "postprocess": ([s]) => s},
    {"name": "num", "symbols": ["composite", "__", "basic"], "postprocess": ([c, _, b]) => c + b},
    {"name": "num", "symbols": ["composite"], "postprocess": ([c]) => c},
    {"name": "num", "symbols": ["ignored", "__", "basic"], "postprocess": ([_1, _2, b]) => b},
    {"name": "num", "symbols": ["basic"], "postprocess": ([b]) => b},
    {"name": "composite$string$1", "symbols": [{"literal":"m"}, {"literal":"ư"}, {"literal":"ờ"}, {"literal":"i"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "composite", "symbols": ["composite$string$1"], "postprocess": _ => 10},
    {"name": "basic$string$1", "symbols": [{"literal":"k"}, {"literal":"h"}, {"literal":"ô"}, {"literal":"n"}, {"literal":"g"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$1"], "postprocess": _ => 0},
    {"name": "basic$string$2", "symbols": [{"literal":"m"}, {"literal":"ộ"}, {"literal":"t"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$2"], "postprocess": _ => 1},
    {"name": "basic$string$3", "symbols": [{"literal":"h"}, {"literal":"a"}, {"literal":"i"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$3"], "postprocess": _ => 2},
    {"name": "basic$string$4", "symbols": [{"literal":"b"}, {"literal":"a"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$4"], "postprocess": _ => 3},
    {"name": "basic$string$5", "symbols": [{"literal":"b"}, {"literal":"ố"}, {"literal":"n"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$5"], "postprocess": _ => 4},
    {"name": "basic$string$6", "symbols": [{"literal":"n"}, {"literal":"ă"}, {"literal":"m"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$6"], "postprocess": _ => 5},
    {"name": "basic$string$7", "symbols": [{"literal":"s"}, {"literal":"á"}, {"literal":"u"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$7"], "postprocess": _ => 6},
    {"name": "basic$string$8", "symbols": [{"literal":"b"}, {"literal":"ả"}, {"literal":"y"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$8"], "postprocess": _ => 7},
    {"name": "basic$string$9", "symbols": [{"literal":"t"}, {"literal":"á"}, {"literal":"m"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$9"], "postprocess": _ => 8},
    {"name": "basic$string$10", "symbols": [{"literal":"c"}, {"literal":"h"}, {"literal":"í"}, {"literal":"n"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "basic", "symbols": ["basic$string$10"], "postprocess": _ => 9},
    {"name": "synonym$string$1", "symbols": [{"literal":"m"}, {"literal":"ố"}, {"literal":"t"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "synonym", "symbols": ["synonym$string$1"], "postprocess": _ => 1},
    {"name": "synonym$string$2", "symbols": [{"literal":"t"}, {"literal":"ư"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "synonym", "symbols": ["synonym$string$2"], "postprocess": _ => 4},
    {"name": "synonym$string$3", "symbols": [{"literal":"l"}, {"literal":"ă"}, {"literal":"m"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "synonym", "symbols": ["synonym$string$3"], "postprocess": _ => 5},
    {"name": "unit$string$1", "symbols": [{"literal":"m"}, {"literal":"ư"}, {"literal":"ơ"}, {"literal":"i"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "unit", "symbols": ["unit$string$1"], "postprocess": _ => 10},
    {"name": "unit$string$2", "symbols": [{"literal":"t"}, {"literal":"r"}, {"literal":"ă"}, {"literal":"m"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "unit", "symbols": ["unit$string$2"], "postprocess": _ => 100},
    {"name": "unit$string$3", "symbols": [{"literal":"n"}, {"literal":"g"}, {"literal":"h"}, {"literal":"ì"}, {"literal":"n"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "unit", "symbols": ["unit$string$3"], "postprocess": _ => 1000},
    {"name": "unit$string$4", "symbols": [{"literal":"n"}, {"literal":"g"}, {"literal":"à"}, {"literal":"n"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "unit", "symbols": ["unit$string$4"], "postprocess": _ => 1000},
    {"name": "ignored$string$1", "symbols": [{"literal":"l"}, {"literal":"i"}, {"literal":"n"}, {"literal":"h"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "ignored", "symbols": ["ignored$string$1"]},
    {"name": "ignored$string$2", "symbols": [{"literal":"l"}, {"literal":"ẻ"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "ignored", "symbols": ["ignored$string$2"]}
]
  , ParserStart: "main"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
