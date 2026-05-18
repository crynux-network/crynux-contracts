declare module "hardhat/config" {
    export interface ConfigurationVariable {
        _type: "ConfigurationVariable";
        name: string;
        format?: string;
    }

    export function configVariable(name: string, format?: string): ConfigurationVariable;
    export function defineConfig<TConfig>(config: TConfig): TConfig;
}
