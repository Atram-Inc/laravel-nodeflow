<?php

namespace Nodeflow;

use Nodeflow\Facts\FactProvider;
use Nodeflow\Facts\FactProviderRegistry;
use Nodeflow\Nodes\NodeRegistry;
use Nodeflow\Triggers\TriggerDriverRegistry;
use Nodeflow\Triggers\TriggerNodeRegistry;
use Nodeflow\Triggers\TriggerSourceRegistry;

class Nodeflow
{
    /** @var (callable(string): ?string)|null */
    private static $publisherNames = null;

    /**
     * Teach the editor how to name the person who published a version.
     * `published_by` stores the publisher's auth identifier; the editor shows
     * "published 2 minutes ago by <name>" when the resolver returns one.
     *
     * @param  (callable(string): ?string)|null  $resolver
     */
    public static function describePublishersUsing(?callable $resolver): void
    {
        static::$publisherNames = $resolver;
    }

    /** The display name for a `published_by` value, or null when unknown. */
    public static function publisherName(?string $publishedBy): ?string
    {
        if ($publishedBy === null || $publishedBy === '' || static::$publisherNames === null) {
            return null;
        }

        $name = (static::$publisherNames)($publishedBy);

        return is_string($name) && $name !== '' ? $name : null;
    }

    public static function nodes(): NodeRegistry
    {
        return app(NodeRegistry::class);
    }

    public static function register(array $nodeClasses): void
    {
        static::nodes()->register(...$nodeClasses);
    }

    public static function facts(): FactProviderRegistry
    {
        return app(FactProviderRegistry::class);
    }

    /** @param list<FactProvider> $providers */
    public static function registerFactProviders(array $providers): void
    {
        static::facts()->register(...$providers);
    }

    public static function triggerNodes(): TriggerNodeRegistry
    {
        return app(TriggerNodeRegistry::class);
    }

    public static function triggerDrivers(): TriggerDriverRegistry
    {
        return app(TriggerDriverRegistry::class);
    }

    public static function triggerSources(): TriggerSourceRegistry
    {
        return app(TriggerSourceRegistry::class);
    }

    public static function registerTriggerNodes(array $classes): void
    {
        static::triggerNodes()->register(...$classes);
    }

    public static function registerTriggerDrivers(array $classes): void
    {
        static::triggerDrivers()->register(...$classes);
    }

    public static function registerTriggerSources(array $classes): void
    {
        static::triggerSources()->register(...$classes);
    }

    /**
     * Register the editor's routes.
     *
     * Called by the host from its own routes file, inside whatever group it wants:
     *
     *     Route::middleware(['web', 'auth'])->prefix('admin')->group(
     *         fn () => Nodeflow::routes()
     *     );
     *
     * Opt-in rather than automatic, because a host running flows with no editor
     * must not be made to depend on Inertia — and because prefix and middleware
     * are decisions only the host can make.
     */
    public static function routes(): void
    {
        require __DIR__.'/Http/routes.php';
    }

    /** Register only the host-configured public webhook entry point. */
    public static function webhookRoutes(): void
    {
        require __DIR__.'/Http/webhook-routes.php';
    }
}
