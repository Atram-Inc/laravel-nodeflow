<?php

namespace Nodeflow\Schema;

class NodeDefinition
{
    private string $group = 'General';

    private array $outputs = ['default'];

    /** @var array{field: string, fallback: string, fallback_label?: string}|null */
    private ?array $outputConfig = null;

    /** @var Field[] */
    private array $fields = [];

    private ?string $icon = null;

    private ?string $description = null;

    private function __construct(public readonly string $label) {}

    public static function make(string $label): self
    {
        return new self($label);
    }

    public function group(string $group): self
    {
        $this->group = $group;

        return $this;
    }

    public function icon(string $icon): self
    {
        $this->icon = $icon;

        return $this;
    }

    public function description(string $description): self
    {
        $this->description = $description;

        return $this;
    }

    public function outputs(array $outputs): self
    {
        $this->outputs = $outputs;
        $this->outputConfig = null;

        return $this;
    }

    /** @param  Field[]  $fields */
    public function fields(array $fields): self
    {
        $this->fields = $fields;

        return $this;
    }

    /** @return Field[] */
    public function fieldObjects(): array
    {
        return $this->fields;
    }

    public function outputsFromConfig(string $field, string $fallback = 'otherwise', ?string $fallbackLabel = null): self
    {
        if ($field === '' || ! preg_match('/^[a-zA-Z0-9_-]+$/D', $fallback)) {
            throw new \InvalidArgumentException('Configurable outputs require a field and a valid fallback identifier.');
        }
        $this->outputConfig = ['field' => $field, 'fallback' => $fallback];
        if ($fallbackLabel !== null) {
            $this->outputConfig['fallback_label'] = $fallbackLabel;
        }
        $this->outputs = [$fallback];

        return $this;
    }

    /** @return list<string> */
    public function outputNames(array $config = []): array
    {
        if ($this->outputConfig === null) {
            return $this->outputs;
        }
        $fallback = $this->outputConfig['fallback'];
        $branches = $config[$this->outputConfig['field']] ?? [];
        $outputs = [];
        foreach (is_array($branches) && array_is_list($branches) ? $branches : [] as $branch) {
            $id = is_array($branch) ? ($branch['id'] ?? null) : null;
            if (is_string($id) && preg_match('/^[a-zA-Z0-9_-]+$/D', $id) && $id !== $fallback && ! in_array($id, $outputs, true)) {
                $outputs[] = $id;
            }
        }

        return [...$outputs, $fallback];
    }

    /** @return array<string, list<string>> */
    public function validateOutputs(array $config): array
    {
        if ($this->outputConfig === null) {
            return [];
        }
        $field = $this->outputConfig['field'];
        $branches = $config[$field] ?? null;
        if (! is_array($branches) || ! array_is_list($branches)) {
            return [$field => ['Outputs must be a list of branches.']];
        }
        $errors = [];
        $seen = [$this->outputConfig['fallback']];
        foreach ($branches as $index => $branch) {
            $id = is_array($branch) ? ($branch['id'] ?? null) : null;
            if (! is_string($id) || ! preg_match('/^[a-zA-Z0-9_-]+$/D', $id) || in_array($id, $seen, true)) {
                $errors["{$field}.{$index}.id"] = ['Each output needs a unique identifier using letters, numbers, underscores or hyphens, distinct from the fallback.'];
            } else {
                $seen[] = $id;
            }
            $label = is_array($branch) ? ($branch['label'] ?? null) : null;
            if (! is_string($label) || trim($label) === '') {
                $errors["{$field}.{$index}.label"] = ['Each output needs a label.'];
            }
        }

        return $errors;
    }

    public function toArray(): array
    {
        return [
            'label' => $this->label,
            'group' => $this->group,
            'icon' => $this->icon,
            'description' => $this->description,
            'outputs' => $this->outputs,
            ...($this->outputConfig === null ? [] : ['output_config' => $this->outputConfig]),
            // toWireArray(), not toArray(): this array is serialised straight to
            // the editor, and a field's options must be one JSON type either way.
            'fields' => array_map(fn (Field $f) => $f->toWireArray(), $this->fields),
        ];
    }

    public function rules(): array
    {
        return array_merge(...array_map(fn (Field $f) => $f->rules(), $this->fields)) ?: [];
    }
}
