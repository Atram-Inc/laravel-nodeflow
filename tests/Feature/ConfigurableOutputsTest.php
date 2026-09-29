<?php

use Nodeflow\Graph\Graph;
use Nodeflow\Graph\GraphValidator;
use Nodeflow\Models\Flow;
use Nodeflow\Nodeflow;
use Nodeflow\Publishing\GraphInvalidException;
use Nodeflow\Publishing\PublishFlow;
use Nodeflow\Schema\NodeDefinition;
use Tests\Support\FakeSendNode;

class ConfigurableOutputsNode extends FakeSendNode
{
    public static function type(): string
    {
        return 'test.configurable';
    }

    public function definition(): NodeDefinition
    {
        return NodeDefinition::make('Branches')->outputsFromConfig('branches', fallback: 'otherwise');
    }

    public function validate(array $config): array
    {
        return [];
    }
}

it('resolves per-instance stable output ids and serializes only dynamic metadata', function () {
    $definition = NodeDefinition::make('Branches')->outputsFromConfig('branches', fallback: 'otherwise');
    expect($definition->outputNames(['branches' => [['id' => 'a', 'label' => 'First']]]))->toBe(['a', 'otherwise'])
        ->and($definition->outputNames(['branches' => [['id' => 'b', 'label' => 'Second']]]))->toBe(['b', 'otherwise'])
        ->and($definition->toArray()['output_config'])->toBe(['field' => 'branches', 'fallback' => 'otherwise'])
        ->and(NodeDefinition::make('Static')->outputs(['yes', 'no'])->toArray())->not->toHaveKey('output_config');
});

it('validates configurable outputs even when a node overrides validation', function () {
    Nodeflow::register([ConfigurableOutputsNode::class]);
    $graph = triggeredGraph(['start' => 'a', 'nodes' => [
        ['id' => 'a', 'type' => 'test.configurable', 'config' => ['branches' => [['id' => 'first', 'label' => 'First']]]],
        ['id' => 'b', 'type' => 'test.configurable', 'config' => ['branches' => [['id' => 'second', 'label' => 'Second']]]],
    ], 'edges' => [['from' => 'a', 'output' => 'first', 'to' => 'b']]]);
    expect(app(GraphValidator::class)->validate(Graph::fromArray($graph))->errors())->toBe([]);
    $graph['nodes'][1]['config']['branches'] = [];
    expect(implode(' ', app(GraphValidator::class)->validate(Graph::fromArray($graph))->errors()))->toContain('has no output [first]');
});

it('rejects malformed output contracts', function ($branches) {
    $definition = NodeDefinition::make('Branches')->outputsFromConfig('branches');
    expect($definition->validateOutputs(['branches' => $branches]))->not->toBe([]);
})->with([
    'not a list' => ['oops'],
    'empty id' => [[['id' => '', 'label' => 'A']]],
    'invalid id' => [[['id' => 'bad id', 'label' => 'A']]],
    'duplicate id' => [[['id' => 'a', 'label' => 'A'], ['id' => 'a', 'label' => 'B']]],
    'fallback collision' => [[['id' => 'otherwise', 'label' => 'A']]],
    'missing label' => [[['id' => 'a']]],
]);

it('refuses publishing malformed configurable outputs even with custom node validation', function () {
    Nodeflow::register([ConfigurableOutputsNode::class]);
    config()->set('nodeflow.tenancy.enabled', false);
    $flow = Flow::create(['name' => 'Branches', 'status' => 'draft', 'tenant_id' => 'org-1']);
    $graph = triggeredGraph(['start' => 'a', 'nodes' => [
        ['id' => 'a', 'type' => 'test.configurable', 'config' => ['branches' => [['id' => 'otherwise', 'label' => 'Collision']]]],
    ], 'edges' => []]);
    expect(fn () => app(PublishFlow::class)->publish($flow, $graph))
        ->toThrow(GraphInvalidException::class, 'unique identifier');
    expect($flow->fresh()->current_version_id)->toBeNull();
});
