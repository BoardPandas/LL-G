---
tech: python
tags: [jinja2, templates, dict, fastapi, starlette]
severity: high
---
# Jinja `obj.items` returns the dict's method, not its "items" key

## PROBLEM
Jinja resolves `obj.name` by trying `getattr(obj, "name")` first and falls back to `obj["name"]` only when no such attribute exists. A dict key that shares its name with a dict method (`items`, `keys`, `values`, `get`, `pop`, `update`, `copy`, `clear`) therefore resolves to the bound method. A view model such as `{"state": "ok", "items": [...]}` passed to a template is the usual way to hit it.

What happens depends on how the template uses the value:

- `{% for x in section.items %}` raises `TypeError: 'builtin_function_or_method' object is not iterable` (loud).
- `{% if section.items %}` is always true, because a bound method is truthy, so an empty list never reaches the `{% else %}` branch (silent).
- `{{ section.items }}` prints `<built-in method items of dict object at 0x...>` (silent).

Other keys on the same dict (`section.state`, `section.count`) work, which makes the dot syntax look safe. Reproduced on Jinja2 3.1.6.

## WRONG
```jinja
{% if section.items %}
  <ul>{% for item in section.items %}<li>{{ item.title }}</li>{% endfor %}</ul>
{% else %}
  <p>Nothing queued.</p>
{% endif %}
```

## RIGHT
```jinja
{% if section["items"] %}
  <ul>{% for item in section["items"] %}<li>{{ item.title }}</li>{% endfor %}</ul>
{% else %}
  <p>Nothing queued.</p>
{% endif %}
```

Subscript syntax tries the key first and the attribute second. Renaming the key to something that is not a dict method (`entries`, `rows`) also works.

## NOTES
- The lookup order is documented in Jinja's template designer docs (Variables, "Implementation"): `foo.bar` tries the attribute, then the item; `foo["bar"]` tries the item, then the attribute.
- Keys such as `title` or `state` are safe because a dict has no attribute by that name.
- Test the empty case. A render test with `"items": []` that asserts the empty-state text catches the silent version; a test with a non-empty list catches only the loud one.
