<?php

use Illuminate\Support\Facades\Artisan;
use Nodeflow\Facts\FactProviderRegistry;
use Nodeflow\Nodeflow;
use Nodeflow\NodeflowServiceProvider;
use Nodeflow\Nodes\Core\ExitNode;
use Nodeflow\Nodes\NodeRegistry;

it('boots and publishes config', function () {
    expect(config('nodeflow.tables.prefix'))->toBe('nodeflow_');
});

it('registers the node packaging commands', function () {
    expect(Artisan::all())->toHaveKeys([
        'nodeflow:make-node-package',
        'nodeflow:extract-node',
        'nodeflow:make-trigger',
        'nodeflow:make-trigger-source',
        'nodeflow:make-trigger-driver',
    ]);
});

it('shares one fact provider registry across the application', function () {
    expect(app(FactProviderRegistry::class))
        ->toBe(app(FactProviderRegistry::class));
});

it('allows a host to omit legacy core nodes from registration', function () {
    config()->set('nodeflow.core_nodes', [ExitNode::class]);
    app()->instance(NodeRegistry::class, new NodeRegistry);

    (new NodeflowServiceProvider(app()))->boot();

    expect(array_keys(Nodeflow::nodes()->all()))->toBe(['core.exit'])
        ->and(Nodeflow::nodes()->has('core.condition'))->toBeFalse()
        ->and(Nodeflow::nodes()->has('core.fact_condition'))->toBeFalse();
});

it('preserves built-ins for older cached configuration but respects an explicitly empty list', function () {
    $legacyConfig = config('nodeflow');
    unset($legacyConfig['core_nodes']);
    config()->set('nodeflow', $legacyConfig);
    app()->instance(NodeRegistry::class, new NodeRegistry);
    (new NodeflowServiceProvider(app()))->boot();
    expect(array_keys(Nodeflow::nodes()->all()))->toBe(['core.exit', 'core.fact_condition', 'core.wait', 'core.condition', 'core.start_flow']);

    config()->set('nodeflow.core_nodes', []);
    app()->instance(NodeRegistry::class, new NodeRegistry);
    (new NodeflowServiceProvider(app()))->boot();
    expect(Nodeflow::nodes()->all())->toBe([]);
});
