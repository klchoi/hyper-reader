@builtin "whitespace.ne"

main ->
	null
	| num __ unit __ main {% ([n, _1, u, _2, m]) => n * u + m %}
	| num __ unit {% ([n, _, u]) => n * u %}
	| num {% ([n]) => n %}
	| synonym {% ([s]) => s %}

num ->
	composite __ basic {% ([c, _, b]) => c + b %}
	| composite {% ([c]) => c %}
	| ignored __ basic {% ([_1, _2, b]) => b %}
	| basic {% ([b]) => b %}

composite ->
	"mười" {% _ => 10 %}

basic ->
	"không" {% _ => 0 %}
	| "một" {% _ => 1 %}
    | "hai" {% _ => 2 %}
    | "ba" {% _ => 3 %}
    | "bốn" {% _ => 4 %}
    | "năm" {% _ => 5 %}
    | "sáu" {% _ => 6 %}
    | "bảy" {% _ => 7 %}
    | "tám" {% _ => 8 %}
    | "chín" {% _ => 9 %}

synonym ->
	"mốt" {% _ => 1 %}
	| "tư" {% _ => 4 %}
	| "lăm" {% _ => 5 %}

unit ->
	"mươi" {% _ => 10 %}
	| "trăm" {% _ => 100 %}
	| "nghìn" {% _ => 1000 %}
	| "ngàn" {% _ => 1000 %}

ignored -> "linh" | "lẻ"
